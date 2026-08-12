from pinecone import Pinecone
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import app.config as config

# Initialize config/dotenv
from dotenv import load_dotenv
load_dotenv()

api_key = os.getenv("PINECONE_API_KEY") or config.PINECONE_API_KEY
index_name = os.getenv("PINECONE_INDEX_NAME") or config.PINECONE_INDEX_NAME

print(f"API Key found: {api_key[:10]}... Index name: {index_name}")

pc = Pinecone(api_key=api_key)
index = pc.Index(index_name)

# Check both namespaces
for ns in ["swiftmove_logistics", "my_company"]:
    try:
        stats = index.describe_index_stats()
        ns_stats = stats.get("namespaces", {}).get(ns, "Not present in namespaces list")
        print(f"Namespace '{ns}': {ns_stats}")
    except Exception as e:
        print(f"Namespace '{ns}': doesn't exist or error: {e}")
