import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app.config as config
from app.database import init_db, db
from app.rag import init_rag, index, embeddings, decrypt_chunks

def check():
    init_db()
    init_rag()
    
    companies = list(db.companies.find())
    for comp in companies:
        company_id = str(comp["_id"])
        print(f"\n==========================================")
        print(f"Company: {comp['name']}, ID: {company_id}, Namespace: {comp.get('pinecone_namespace')}")
        namespace = comp.get('pinecone_namespace', 'default')
        
        # Query with high top_k to fetch all chunks
        query_vector = embeddings.embed_query("Meesho")
        res = index.query(vector=query_vector, top_k=100, include_metadata=True, namespace=namespace)
        print(f"Found {len(res.matches)} matches in Pinecone:")
        
        slack_matches = []
        for idx, match in enumerate(res.matches):
            text = match.metadata.get("text", "")
            is_encrypted = match.metadata.get("encrypted", False)
            if is_encrypted:
                from app.encryption import decrypt_text
                text = decrypt_text(text, company_id)
            
            source = match.metadata.get('source', 'unknown')
            # Look for any matches containing 'Meesho' or from Slack
            if "meesho" in text.lower() or "meesho" in source.lower():
                safe_text = text[:150].encode('ascii', errors='replace').decode('ascii')
                print(f"  Match {idx+1}: Score: {match.score:.4f}, Source: {source}, Realtime: {match.metadata.get('realtime')}, Text: {safe_text}")

if __name__ == "__main__":
    check()
