import os
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_API_KEY_BACKUP = os.getenv("GEMINI_API_KEY_BACKUP")
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
PINECONE_INDEX_NAME = os.getenv("PINECONE_INDEX_NAME")

# Basic validation logic (warnings instead of direct crash on startup, to allow container/deployment setup)
def validate_config():
    missing = []
    if not GEMINI_API_KEY:
        missing.append("GEMINI_API_KEY")
    if not PINECONE_API_KEY:
        missing.append("PINECONE_API_KEY")
    if missing:
        print(f"WARNING: The following environment variables are missing: {', '.join(missing)}")
        print("Please configure them in your backend/.env file before running requests.")
