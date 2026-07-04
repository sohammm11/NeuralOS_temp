import json
from app.database import save_graph_node, save_graph_relationship, db

def extract_entities_from_chunks(chunks: list, llm, company_id: str):
    """
    Uses Gemini to extract entities and relationships from text chunks.
    """
    if not chunks:
        return {"nodes": 0, "relationships": 0}

    # Combine chunks into one context (max 3000 chars)
    combined = "\n\n".join([c[:300] for c in chunks[:15]])

    prompt = f"""
You are an entity extractor for a company knowledge graph.

Analyze this company data and extract entities and relationships.

Return ONLY valid JSON in this exact format, nothing else:
{{
  "entities": [
    {{"name": "John Smith", "type": "Person", "properties": {{"role": "CEO"}}}},
    {{"name": "Acme Corp", "type": "Client", "properties": {{"health": "at_risk"}}}},
    {{"name": "Login Bug", "type": "Incident", "properties": {{"status": "resolved"}}}},
    {{"name": "Mobile App", "type": "Project", "properties": {{"status": "active"}}}}
  ],
  "relationships": [
    {{"from": "John Smith", "to": "Login Bug", "type": "FIXED"}},
    {{"from": "John Smith", "to": "Acme Corp", "type": "OWNS_ACCOUNT"}}
  ]
}}

Rules:
- Only extract entities clearly mentioned in the text
- Person types: employees, team members mentioned by name
- Client types: customers, clients, partner companies
- Incident types: bugs, outages, SLA breaches, incidents
- Project types: products, features, initiatives being built
- Relationship types: FIXED, OWNS_ACCOUNT, MANAGES, CAUSED, AFFECTED, DECIDED, CLOSED_DEAL, OWNS
- health for clients must be: at_risk, healthy, or onboarding
- status for incidents: resolved or open
- status for projects: active, planned, or completed
- Maximum 20 entities, 20 relationships
- If nothing clear found, return empty arrays

Company data:
{combined}
"""

    try:
        response = llm.invoke(prompt)
        content = response.content.strip()

        # Clean JSON
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[1].split("```")[0].strip()

        data = json.loads(content)
        entities = data.get("entities", [])
        relationships = data.get("relationships", [])

        # Save to MongoDB
        saved_entities = set()
        for entity in entities:
            name = entity.get("name", "").strip()
            entity_type = entity.get("type", "").strip()
            props = entity.get("properties", {})
            if name and entity_type:
                save_graph_node(company_id, entity_type, name, props)
                saved_entities.add(name)

        saved_rels = 0
        for rel in relationships:
            from_node = rel.get("from", "").strip()
            to_node = rel.get("to", "").strip()
            rel_type = rel.get("type", "").strip()
            if from_node in saved_entities and to_node in saved_entities and rel_type:
                save_graph_relationship(company_id, from_node, to_node, rel_type)
                saved_rels += 1

        return {
            "nodes": len(saved_entities),
            "relationships": saved_rels
        }

    except Exception as e:
        print(f"Entity extraction failed: {e}")
        return {"nodes": 0, "relationships": 0}


def get_chunks_from_pinecone(index, namespace: str, embeddings, topics: list):
    """
    Fetches relevant chunks from Pinecone for entity extraction.
    """
    all_chunks = []
    seen = set()

    for topic in topics:
        try:
            vector = embeddings.embed_query(topic)
            results = index.query(
                vector=vector,
                top_k=5,
                include_metadata=True,
                namespace=namespace
            )
            for match in results.matches:
                text = match.metadata.get("text", "")
                if text and text not in seen:
                    all_chunks.append(text)
                    seen.add(text)
        except Exception as e:
            print(f"Pinecone fetch failed for topic '{topic}': {e}")

    return all_chunks