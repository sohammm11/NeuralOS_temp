import os
from langchain_google_genai import GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI
from pinecone import Pinecone
import app.config as config
from app.graph import query_graph, graph_enabled
from app.feedback import get_relevant_corrections

# Global variables initialized to None
embeddings = None
pc_client = None
index = None
llm = None

def init_rag():
    global embeddings, pc_client, index, llm
    print("DEBUG init_rag: starting...")
    
    # Check if keys are present
    if not config.GEMINI_API_KEY or not config.PINECONE_API_KEY:
        print(f"DEBUG init_rag: missing keys - GEMINI={bool(config.GEMINI_API_KEY)} PINECONE={bool(config.PINECONE_API_KEY)}")
        return False
        
    try:
        print("DEBUG init_rag: initializing embeddings...")
        # 1. Initialize Gemini Embeddings
        embeddings = GoogleGenerativeAIEmbeddings(
            model="models/gemini-embedding-001",
            google_api_key=config.GEMINI_API_KEY,
            output_dimensionality=768
        )
        
        # 2. Initialize Pinecone client & Vector store index
        pc_client = Pinecone(api_key=config.PINECONE_API_KEY)
        
        # Check if the index exists in pinecone
        active_indexes = [idx.name for idx in pc_client.list_indexes()]
        if config.PINECONE_INDEX_NAME not in active_indexes:
            print(f"WARNING: Pinecone index '{config.PINECONE_INDEX_NAME}' was not found in active indexes: {active_indexes}.")
            print("Please create the index in your Pinecone console with 768 dimensions (cosine metric) or run the ingestion script to initialize.")
            return False
            
        index = pc_client.Index(config.PINECONE_INDEX_NAME)
        
        # 3. Initialize Gemini Chat LLM
        llm = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            google_api_key=config.GEMINI_API_KEY,
            temperature=0.2,
            streaming=True
        )
        return True
    except Exception as e:
        print(f"Error initializing RAG system: {e}")
        return False

# Try initializing on module load
rag_enabled = init_rag()

def rewrite_query(question: str, history: list = []) -> str:
    """
    Rewrites the user question into an optimized search query
    before hitting the vector index.
    """
    try:
        history_context = ""
        if history:
            last_few = history[-3:]
            history_context = "Recent conversation:\n" + "\n".join([
                f"{m.role}: {m.content[:100]}" for m in last_few
            ]) + "\n\n"

        prompt = f"""You are a search query optimizer for a company knowledge base.

{history_context}Original question: {question}

Rewrite this into 1-3 specific search queries that will retrieve the most relevant company documents.
Focus on: key entities (people, clients, projects), specific events, technical terms, dates.
Remove filler words. Add relevant synonyms.

Return ONLY the rewritten query as a single line. No explanation.
If the question is already specific, return it as-is.

Rewritten query:"""

        # Use gemini-1.5-flash for faster query rewriting
        rewrite_llm = ChatGoogleGenerativeAI(
            model="gemini-1.5-flash",
            google_api_key=config.GEMINI_API_KEY or os.getenv("GEMINI_API_KEY"),
            temperature=0,
            streaming=False
        )

        try:
            response = rewrite_llm.invoke(prompt)
        except Exception as rate_err:
            if "429" in str(rate_err) and config.GEMINI_API_KEY_BACKUP:
                backup_llm = ChatGoogleGenerativeAI(
                    model="gemini-2.0-flash-lite",
                    google_api_key=config.GEMINI_API_KEY_BACKUP,
                    temperature=0,
                    streaming=False
                )
                response = backup_llm.invoke(prompt)
            else:
                raise rate_err

        rewritten = response.content.strip().split('\n')[0].strip()
        print(f"DEBUG query rewrite: '{question[:40]}' → '{rewritten[:40]}'")
        return rewritten if rewritten else question

    except Exception as e:
        print(f"Query rewrite failed, using original: {e}")
        return question

def check_retrieval_quality(matches: list, threshold: float = 0.55) -> dict:
    """
    Checks if retrieved chunks are actually relevant.
    Returns quality assessment before we trust the results.
    """
    if not matches:
        return {
            "quality": "empty",
            "confident": False,
            "max_score": 0,
            "avg_score": 0,
            "message": "No documents found in knowledge base."
        }

    scores = [m.score for m in matches]
    max_score = max(scores)
    avg_score = sum(scores) / len(scores)

    if max_score < threshold:
        return {
            "quality": "low",
            "confident": False,
            "max_score": round(max_score, 3),
            "avg_score": round(avg_score, 3),
            "message": f"Best match score {round(max_score*100, 1)}% is below confidence threshold. Answer may be unreliable."
        }
    elif max_score < 0.70:
        return {
            "quality": "medium",
            "confident": True,
            "max_score": round(max_score, 3),
            "avg_score": round(avg_score, 3),
            "message": "Moderate confidence."
        }
    else:
        return {
            "quality": "high",
            "confident": True,
            "max_score": round(max_score, 3),
            "avg_score": round(avg_score, 3),
            "message": "High confidence retrieval."
        }

import cohere
import os

def rerank_chunks(question: str, chunks: list, sources: list) -> list:
    """
    Reranks retrieved chunks using Cohere reranker.
    Returns reranked (chunk, source) pairs.
    Falls back to original order if reranking fails.
    """
    try:
        cohere_key = os.getenv("COHERE_API_KEY")
        if not cohere_key or not chunks:
            return list(zip(chunks, sources))

        co = cohere.Client(cohere_key)
        
        response = co.rerank(
            model="rerank-english-v3.0",
            query=question,
            documents=chunks,
            top_n=min(4, len(chunks))
        )

        reranked = []
        for result in response.results:
            idx = result.index
            reranked.append((chunks[idx], sources[idx]))
        
        print(f"DEBUG rerank: reordered {len(reranked)} chunks")
        return reranked

    except Exception as e:
        print(f"Reranking failed, using original order: {e}")
        return list(zip(chunks, sources))

def query_rag(question: str, history: list = [], namespace: str = "default"):
    """
    Search Pinecone vector store, construct the prompt, query Gemini, and return the answer + sources.
    If RAG setup is incomplete, fallback to a clean system response.
    """
    global rag_enabled, index, llm, embeddings
    
    # Double check initialization in case keys were updated later
    if not rag_enabled:
        rag_enabled = init_rag()
        
    if not rag_enabled or not index or not llm or not embeddings:
        # Return fallback mock responses for demonstration (so the system works out of the box)
        return get_mock_response(question)
        
    try:
        # 1. Rewrite query for better retrieval
        rewritten_question = rewrite_query(question, history)

        # 2. Embed the rewritten question
        query_vector = embeddings.embed_query(rewritten_question)

        # 3. Search Pinecone with more candidates for reranking
        search_response = index.query(
            vector=query_vector,
            top_k=8,
            include_metadata=True,
            namespace=namespace
        )

        # 4. Quality gate
        quality = check_retrieval_quality(search_response.matches)
        if not quality["confident"]:
            return {
                "answer": f"I don't have reliable information about this. {quality['message']} Try syncing more data in the Sources tab.",
                "sources": [],
                "quality": quality
            }

        # 5. Extract chunks and sources
        raw_chunks = []
        raw_sources = []
        for match in search_response.matches:
            text = match.metadata.get("text", "")
            source = match.metadata.get("source", "Unknown Source")
            if text:
                raw_chunks.append(text)
                raw_sources.append(source)

        # 6. Rerank
        reranked = rerank_chunks(rewritten_question, raw_chunks, raw_sources)
        context_chunks = [r[0] for r in reranked]
        sources = set([r[1] for r in reranked])
            
        context_text = "\n\n---\n\n".join(context_chunks)
        
        # Enhance with graph context
        if graph_enabled:
            graph_results = query_graph(question)
            if graph_results and graph_results != ["No specific graph context found."]:
                graph_context = "\n".join(graph_results)
                context_text = context_text + "\n\n---\nKnowledge Graph Context:\n" + graph_context
        
        if not context_text:
            return {
                "answer": "No relevant information found. Try syncing your tools in the Sources tab to add more company knowledge.",
                "sources": []
            }
            
        # Check for past corrections
        corrections = get_relevant_corrections(question)
        if corrections:
            correction_text = "\n".join([
                f"Previous correction: Q: {c['question']} → Correct answer: {c['correction']}"
                for c in corrections
            ])
            context_text = correction_text + "\n\n---\n\n" + context_text
            
        # 4. Construct the prompt for Gemini
        history_text = ""
        if history:
            history_text = "Previous conversation:\n"
            for msg in history:
                role = "User" if msg.role == "user" else "NeuralOS"
                history_text += f"{role}: {msg.content}\n"
            history_text += "\n"

        system_prompt = (
            "You are NeuralOS, an AI reasoning core that reads company documentation and answers questions.\n"
            "Answer the question based only on the provided context and conversation history. "
            "If the context doesn't contain the answer, honestly state that you don't have enough context. "
            "Keep the answer professional and factual.\n\n"
            f"Context:\n{context_text}\n\n"
            f"{history_text}"
            f"Current question: {question}\n\n"
            "Answer:"
        )
        
        # 5. Invoke LLM
        try:
            response = llm.invoke(system_prompt)
        except Exception as e:
            if "429" in str(e) and config.GEMINI_API_KEY_BACKUP:
                backup_llm = ChatGoogleGenerativeAI(
                    model="gemini-2.5-flash",
                    google_api_key=config.GEMINI_API_KEY_BACKUP,
                    temperature=0.2,
                    streaming=True
                )
                response = backup_llm.invoke(system_prompt)
            else:
                raise e
        
        return {
            "answer": response.content,
            "sources": list(sources)
        }
    except Exception as e:
        print(f"RAG query execution failed: {e}")
        return {
            "answer": f"Error executing search query: {e}. Please check your connection or API configuration.",
            "sources": []
        }

def get_mock_response(question: str):
    """
    Mock RAG query responses for demonstration when API keys are missing.
    """
    q_lower = question.lower()
    
    # Mock databases responses corresponding to frontend demo flows
    if "flipkart" in q_lower:
        return {
            "answer": "Our SLA breach with Flipkart last month was caused by a critical route optimization API timeout incident.\n\n- Impact: 47 packages delayed.\n- Root Cause: Route optimization API timed out under peak regional load.\n- Resolution: Handled dynamically by Dev Mehta (timeout threshold patched).",
            "sources": ["Notion: Flipkart Incident Post-Mortem", "Slack: #incidents"]
        }
    elif "risk" in q_lower or "client" in q_lower:
        return {
            "answer": "Flipkart is currently marked as our most at-risk client due to the recent SLA breach involving 47 delayed packages.",
            "sources": ["Notion: Flipkart Client Account", "Slack: #operations"]
        }
    elif "route" in q_lower or "api" in q_lower:
        return {
            "answer": "The Route Optimization API handles multi-point drop coordination across Mumbai sectors. Its primary vulnerability is high-latency cascading timeouts during peak operational hours (10 AM - 2 PM).",
            "sources": ["Notion: Architecture Overview", "Slack: #engineering"]
        }
    else:
        return {
            "answer": f"API keys are not configured in backend/.env. (Running in local Demo mode).\n\nYou queried: '{question}'. Set your API keys in your .env to connect to Gemini and Pinecone.",
            "sources": ["System Configuration"]
        }
async def query_rag_stream(question: str, history: list = [], namespace: str = "default"):
    print(f"DEBUG stream: namespace={namespace} question={question[:30]}")
    """
    Streaming version of query_rag.
    Yields chunks as they come from Gemini.
    """
    global rag_enabled, index, llm, embeddings

    if not rag_enabled:
        rag_enabled = init_rag()

    if not rag_enabled or not index or not llm or not embeddings:
        print(f"DEBUG: using mock - rag_enabled={rag_enabled} index={index is not None} llm={llm is not None} embeddings={embeddings is not None}")
        mock = get_mock_response(question)
        # Stream mock response word by word
        words = mock["answer"].split(" ")
        for word in words:
            yield {"type": "text", "content": word + " "}
        yield {"type": "sources", "sources": mock["sources"]}
        return

    try:
        # 1. Rewrite query
        yield {"type": "thinking", "step": "searching", "content": "Optimizing search query..."}
        rewritten_question = rewrite_query(question, history)

        # 2. Embed
        print("DEBUG: yielded searching step")
        query_vector = embeddings.embed_query(rewritten_question)

        # 3. Search Pinecone
        search_response = index.query(
            vector=query_vector,
            top_k=8,
            include_metadata=True,
            namespace=namespace
        )

        # 4. Quality gate
        quality = check_retrieval_quality(search_response.matches)
        if not quality["confident"]:
            yield {
                "type": "text",
                "content": f"I don't have reliable information about this. {quality['message']} Try syncing more data in the Sources tab."
            }
            yield {"type": "sources", "sources": []}
            yield {"type": "quality", "data": quality}
            return

        # 5. Extract
        raw_chunks = []
        raw_sources = []
        source_scores = []

        for match in search_response.matches:
            text = match.metadata.get("text", "")
            source = match.metadata.get("source", "Unknown Source")
            score = round(match.score * 100, 1)
            if text:
                raw_chunks.append(text)
                raw_sources.append(source)
                source_scores.append({"source": source, "score": score})

        yield {
            "type": "thinking",
            "step": "retrieved",
            "content": f"Found {len(raw_chunks)} chunks, reranking...",
            "sources": source_scores
        }

        # 6. Rerank
        reranked = rerank_chunks(rewritten_question, raw_chunks, raw_sources)
        context_chunks = [r[0] for r in reranked]
        sources = set([r[1] for r in reranked])

        yield {"type": "thinking", "step": "reasoning", "content": "Reasoning across sources..."}

        context_text = "\n\n---\n\n".join(context_chunks)
        
        # Enhance with graph context
        if graph_enabled:
            graph_results = query_graph(question)
            if graph_results and graph_results != ["No specific graph context found."]:
                graph_context = "\n".join(graph_results)
                context_text = context_text + "\n\n---\nKnowledge Graph Context:\n" + graph_context
        
        if not context_text:
            yield {"type": "text", "content": "I couldn't find relevant documents."}
            yield {"type": "sources", "sources": []}
            return

        # Check for past corrections
        corrections = get_relevant_corrections(question)
        if corrections:
            correction_text = "\n".join([
                f"Previous correction: Q: {c['question']} → Correct answer: {c['correction']}"
                for c in corrections
            ])
            context_text = correction_text + "\n\n---\n\n" + context_text

        # 4. Build prompt
        history_text = ""
        if history:
            history_text = "Previous conversation:\n"
            for msg in history:
                role = "User" if msg.role == "user" else "NeuralOS"
                history_text += f"{role}: {msg.content}\n"
            history_text += "\n"

        system_prompt = (
            "You are NeuralOS, an AI reasoning core that reads company documentation and answers questions.\n"
            "Answer the question based only on the provided context and conversation history. "
            "If the context doesn't contain the answer, honestly state that you don't have enough context. "
            "Keep the answer professional and factual.\n\n"
            f"Context:\n{context_text}\n\n"
            f"{history_text}"
            f"Current question: {question}\n\n"
            "Answer:"
        )

        # 5. Stream from Gemini
        try:
            active_llm = llm
            async for chunk in active_llm.astream(system_prompt):
                if chunk.content:
                    yield {"type": "text", "content": chunk.content}
        except Exception as e:
            if "429" in str(e) and config.GEMINI_API_KEY_BACKUP:
                backup_llm = ChatGoogleGenerativeAI(
                    model="gemini-2.5-flash",
                    google_api_key=config.GEMINI_API_KEY_BACKUP,
                    temperature=0.2,
                    streaming=True
                )
                async for chunk in backup_llm.astream(system_prompt):
                    if chunk.content:
                        yield {"type": "text", "content": chunk.content}
            else:
                raise e
        yield {"type": "sources", "sources": list(sources)}
        return

    except Exception as e:
        yield {"type": "text", "content": f"Error: {str(e)}"}
        yield {"type": "sources", "sources": []}