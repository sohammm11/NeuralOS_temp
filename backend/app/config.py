import os
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_API_KEY_BACKUP = os.getenv("GEMINI_API_KEY_BACKUP")
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
PINECONE_INDEX_NAME = os.getenv("PINECONE_INDEX_NAME")
NEO4J_URI = os.getenv("NEO4J_URI")
NEO4J_USERNAME = os.getenv("NEO4J_USERNAME")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD")
MONGODB_URI = os.getenv("MONGODB_URI")

# Basic validation logic (warnings instead of direct crash on startup, to allow container/deployment setup)
def validate_config():
    missing = []
    if not GEMINI_API_KEY:
        missing.append("GEMINI_API_KEY")
    if not PINECONE_API_KEY:
        missing.append("PINECONE_API_KEY")
    if not MONGODB_URI:
        missing.append("MONGODB_URI")
    if missing:
        print(f"WARNING: Missing environment variables: {', '.join(missing)}")
    if GEMINI_API_KEY_BACKUP:
        print("INFO: Backup Gemini API key loaded successfully.")
