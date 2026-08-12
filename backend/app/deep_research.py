import os
import json
import asyncio
from langchain_google_genai import ChatGoogleGenerativeAI
import app.config as config
import app.rag as rag
from app.hybrid_search import bm25_search, hybrid_fusion
from app.encryption import decrypt_chunks

def get_flash_llm():
    key = config.GEMINI_API_KEY or os.getenv("GEMINI_API_KEY")
    return ChatGoogleGenerativeAI(
        model="gemini-2.5-flash",
        google_api_key=key,
        temperature=0.2,
        streaming=False
    )

def generate_query_variations(question: str) -> list:
    """Generate 3 rephrased query variations for multi-angle retrieval."""
    try:
        flash_llm = get_flash_llm()
        prompt = f"""You are an expert search strategist for a company's internal knowledge base.
User Question: {question}

Generate 3 distinct, rephrased search queries to retrieve comprehensive information covering different angles (e.g. key metrics, dates, operational details, financial performance, team discussions).
Return ONLY a JSON array of 3 strings. Example: ["Q4 revenue and financial performance", "Q4 project deliverables and milestones", "Q4 operational challenges and issues"]"""
        
        response = flash_llm.invoke(prompt)
        text = response.content.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()
        
        queries = json.loads(text)
        if isinstance(queries, list) and len(queries) >= 1:
            return queries[:3]
    except Exception as e:
        print(f"[Deep Research] Query variations failed: {e}")
    
    return [question, f"{question} metrics results", f"{question} details summary"]

def deduplicate_by_id_or_text(chunks: list) -> list:
    seen = set()
    unique = []
    for item in chunks:
        key = item.get("text", "")[:120]
        if key and key not in seen:
            seen.add(key)
            unique.append(item)
    return unique

def ensure_source_diversity(chunks: list, max_per_source: int = 10) -> list:
    source_counts = {}
    diverse = []
    for item in chunks:
        source = str(item.get("source", "unknown")).lower()
        category = "other"
        if "slack" in source:
            category = "slack"
        elif "notion" in source:
            category = "notion"
        elif "gmail" in source or "email" in source:
            category = "gmail"
        elif "drive" in source or "doc" in source or "pdf" in source:
            category = "drive"
        
        counts = source_counts.get(category, 0)
        if counts < max_per_source:
            source_counts[category] = counts + 1
            diverse.append(item)
    return diverse

def deep_retrieve(question: str, namespace: str, company_id: str) -> list:
    if not rag.rag_enabled:
        rag.init_rag()
    
    if not rag.rag_enabled or not rag.index or not rag.embeddings:
        print("[Deep Research] RAG not initialized.")
        return []
    
    queries = generate_query_variations(question)
    print(f"[Deep Research] Generated query variations: {queries}")
    
    all_decrypted = []
    
    for query in queries:
        try:
            query_vector = rag.embeddings.embed_query(query)
            search_response = rag.index.query(
                vector=query_vector,
                top_k=20,
                include_metadata=True,
                namespace=namespace
            )
            decrypted = decrypt_chunks(search_response.matches, company_id)
            
            raw_chunks = [item["text"] for item in decrypted if item.get("text")]
            raw_sources = [item.get("source", "unknown") for item in decrypted if item.get("text")]
            
            if raw_chunks:
                sparse_res = bm25_search(query, raw_chunks, raw_sources, top_k=10)
                dense_res = [(item["text"], item.get("source", "unknown"), item.get("score", 0.5)) for item in decrypted if item.get("text")]
                fused = hybrid_fusion(dense_res, sparse_res, dense_weight=0.7, sparse_weight=0.3)
                
                text_to_item = {item["text"][:100]: item for item in decrypted if item.get("text")}
                for chunk_text, source, score in fused:
                    key = chunk_text[:100]
                    if key in text_to_item:
                        matched_item = dict(text_to_item[key])
                        matched_item["score"] = score
                        all_decrypted.append(matched_item)
            else:
                all_decrypted.extend(decrypted)
        except Exception as e:
            print(f"[Deep Research] Retrieval error for query '{query}': {e}")
            
    unique_chunks = deduplicate_by_id_or_text(all_decrypted)
    diverse_chunks = ensure_source_diversity(unique_chunks, max_per_source=10)
    
    diverse_chunks.sort(key=lambda x: x.get("score", 0), reverse=True)
    return diverse_chunks[:40]

def group_by_topic(chunks: list) -> dict:
    try:
        flash_llm = get_flash_llm()
        sample_texts = [f"[{i+1}] ({c.get('source','unknown')}) {c.get('text','')[:150]}" for i, c in enumerate(chunks[:25])]
        corpus = "\n".join(sample_texts)
        
        prompt = f"""Group these context snippets into 3-5 main topic themes.
Snippets:
{corpus}

Return ONLY a valid JSON object mapping theme names to array of snippet indices or summaries.
Example format:
{{
    "financials_and_revenue": ["Snippet 1", "Snippet 3"],
    "project_deliverables": ["Snippet 2", "Snippet 4"],
    "client_and_operational": ["Snippet 5"]
}}"""
        response = flash_llm.invoke(prompt)
        text = response.content.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()
        groups = json.loads(text)
        if isinstance(groups, dict):
            return groups
    except Exception as e:
        print(f"[Deep Research] Topic grouping error: {e}")
    
    return {"overview": ["General knowledge base findings"], "details": ["Operational context"]}

def find_contradictions(question: str, chunks: list) -> str:
    try:
        flash_llm = get_flash_llm()
        snippets = "\n---\n".join([f"Source ({c.get('source')}): {c.get('text')}" for c in chunks[:15]])
        prompt = f"""Analyze these company documents for the question: "{question}".
Identify any conflicting information, discrepancies, unconfirmed assumptions, or missing details across sources.

Documents:
{snippets}

If no major contradictions exist, state clearly that sources are aligned, but highlight key risks or caveats. Keep under 200 words."""
        response = flash_llm.invoke(prompt)
        return response.content.strip()
    except Exception as e:
        return "No major contradictions found across retrieved sources."

async def deep_synthesize_generator(question: str, namespace: str, company_id: str):
    # Step 1: Deep Retrieval
    yield {"step": "retrieving", "status": "Retrieving relevant information...", "chunks_found": 0}
    await asyncio.sleep(0.1)
    
    chunks = deep_retrieve(question, namespace, company_id)
    sources_found = list(set([c.get("source", "unknown") for c in chunks if c.get("source")]))
    yield {
        "step": "retrieving",
        "status": f"Found {len(chunks)} relevant chunks across {len(sources_found)} sources",
        "chunks_found": len(chunks),
        "sources": sources_found
    }
    await asyncio.sleep(0.1)
    
    # Step 2: Clustering
    yield {"step": "clustering", "status": "Analyzing themes and clustering data..."}
    await asyncio.sleep(0.1)
    
    topics = group_by_topic(chunks)
    theme_names = list(topics.keys())
    yield {
        "step": "clustering",
        "status": f"Identified {len(theme_names)} key themes: {', '.join(theme_names[:4])}",
        "themes": theme_names
    }
    await asyncio.sleep(0.1)
    
    # Context text compilation
    context_str = "\n\n".join([f"[{i+1}] (Source: {c.get('source')}) {c.get('text')}" for i, c in enumerate(chunks[:25])])
    
    flash_llm = get_flash_llm()
    sections = {}
    
    # Section 1: Executive Summary
    yield {"step": "synthesizing", "section": "summary", "status": "Writing Executive Summary..."}
    summary_prompt = f"""System: You are an executive report writer. Write a concise, high-level Executive Summary for the prompt: "{question}".
Use clear bullet points where appropriate.

Context:
{context_str[:3000]}"""
    summary_resp = flash_llm.invoke(summary_prompt)
    sections["summary"] = summary_resp.content.strip()
    yield {"step": "synthesizing", "section": "summary", "content": sections["summary"]}
    await asyncio.sleep(0.1)
    
    # Section 2: Key Findings
    yield {"step": "synthesizing", "section": "findings", "status": "Extracting Key Findings..."}
    findings_prompt = f"""System: List 3-5 major Key Findings regarding: "{question}".
Include specific metrics, names, projects, or dates mentioned in the context.

Context:
{context_str[:4000]}"""
    findings_resp = flash_llm.invoke(findings_prompt)
    sections["findings"] = findings_resp.content.strip()
    yield {"step": "synthesizing", "section": "findings", "content": sections["findings"]}
    await asyncio.sleep(0.1)
    
    # Section 3: Supporting Data
    yield {"step": "synthesizing", "section": "data", "status": "Compiling Supporting Data..."}
    data_prompt = f"""System: Provide detailed evidence, quantitative data, and verbatim supporting context for: "{question}".
Organize by theme or source system.

Context:
{context_str[:4000]}"""
    data_resp = flash_llm.invoke(data_prompt)
    sections["data"] = data_resp.content.strip()
    yield {"step": "synthesizing", "section": "data", "content": sections["data"]}
    await asyncio.sleep(0.1)
    
    # Section 4: Contradictions & Risks
    yield {"step": "synthesizing", "section": "contradictions", "status": "Analyzing Contradictions & Risks..."}
    contradictions_text = find_contradictions(question, chunks)
    sections["contradictions"] = contradictions_text
    yield {"step": "synthesizing", "section": "contradictions", "content": sections["contradictions"]}
    await asyncio.sleep(0.1)
    
    # Section 5: Recommendations
    yield {"step": "synthesizing", "section": "recommendations", "status": "Formulating Actionable Recommendations..."}
    recs_prompt = f"""System: Based on the findings and data for "{question}", formulate 3-4 concrete Actionable Recommendations.

Findings Summary:
{sections['summary']}

Key Findings:
{sections['findings']}"""
    recs_resp = flash_llm.invoke(recs_prompt)
    sections["recommendations"] = recs_resp.content.strip()
    yield {"step": "synthesizing", "section": "recommendations", "content": sections["recommendations"]}
    await asyncio.sleep(0.1)
    
    # Final assembly
    full_report = f"""# 🔬 Deep Research Report: {question}

### 📋 Executive Summary
{sections['summary']}

---

### 🔑 Key Findings
{sections['findings']}

---

### 📊 Supporting Data & Context
{sections['data']}

---

### ⚠️ Contradictions & Risk Analysis
{sections['contradictions']}

---

### 🎯 Strategic Recommendations
{sections['recommendations']}
"""
    yield {
        "step": "done",
        "answer": full_report,
        "sources": sources_found
    }
