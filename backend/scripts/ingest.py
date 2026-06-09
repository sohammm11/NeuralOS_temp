import os
import sys
import uuid
from dotenv import load_dotenv

# Ensure the parent folder (backend) is on the Python path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app.config as config
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from pinecone import Pinecone, ServerlessSpec

def main():
    print("=" * 60)
    print("      NeuralOS - Document Ingestion Script (Step 2)      ")
    print("=" * 60)
    
    # 1. Verify Configuration
    if not config.GEMINI_API_KEY or not config.PINECONE_API_KEY:
        print("ERROR: GEMINI_API_KEY or PINECONE_API_KEY is missing in backend/.env")
        print("Please configure your .env file before running this script.")
        sys.exit(1)
        
    print(f"Connecting to Pinecone index: '{config.PINECONE_INDEX_NAME}'...")
    
    try:
        # 2. Connect to Pinecone and ensure index exists
        pc = Pinecone(api_key=config.PINECONE_API_KEY)
        
        # Check if the index exists
        existing_indexes = [idx.name for idx in pc.list_indexes()]
        
        if config.PINECONE_INDEX_NAME not in existing_indexes:
            print(f"Index '{config.PINECONE_INDEX_NAME}' not found. Attempting to create it on the serverless free tier...")
            try:
                pc.create_index(
                    name=config.PINECONE_INDEX_NAME,
                    dimension=768, # Dimension size for Gemini text-embedding-004
                    metric="cosine",
                    spec=ServerlessSpec(
                        cloud="aws",
                        region="us-east-1" # standard region for Pinecone starter plan/free tier
                    )
                )
                print(f"Successfully created Pinecone index: '{config.PINECONE_INDEX_NAME}'!")
            except Exception as create_err:
                print(f"Failed to auto-create index: {create_err}")
                print("Please create the index manually in your Pinecone dashboard with 768 dimensions (cosine metric).")
                sys.exit(1)
        else:
            print(f"Connected to existing Pinecone index: '{config.PINECONE_INDEX_NAME}'")
            
        # 3. Prompt for Document Source name
        print("\nEnter document source name (e.g., 'Notion: Flipkart Incident Post-Mortem' or 'Slack: #incidents'):")
        source_name = input("> ").strip()
        if not source_name:
            source_name = "Manual Ingestion Paste"
            
        # 4. Prompt for Content
        print("\nPaste the content below. Press Enter and type 'EOF' on a new line when done:")
        content_lines = []
        while True:
            try:
                line = input()
                if line.strip() == "EOF":
                    break
                content_lines.append(line)
            except EOFError:
                break
                
        document_text = "\n".join(content_lines).strip()
        if not document_text:
            print("ERROR: Content is empty. Ingestion aborted.")
            sys.exit(1)
            
        print(f"\nProcessing content ({len(document_text)} characters)...")
        
        # 5. Chunk the text
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=800,
            chunk_overlap=100,
            length_function=len
        )
        chunks = text_splitter.split_text(document_text)
        print(f"Split document into {len(chunks)} chunks.")
        
        # 6. Initialize Gemini Embeddings
        print("Initializing Gemini Embeddings (model: gemini-embedding-001)...")
        embeddings = GoogleGenerativeAIEmbeddings(
            model="models/gemini-embedding-001",
            google_api_key=config.GEMINI_API_KEY,
            output_dimensionality=768
        )
        
        # 7. Embed chunks and upload directly using Pinecone client
        print("Embedding document chunks...")
        vectors = embeddings.embed_documents(chunks)
        
        print("Uploading embedded vectors to Pinecone index...")
        index = pc.Index(config.PINECONE_INDEX_NAME)
        
        # Prepare payloads for Pinecone upsert
        upsert_data = []
        for idx, (chunk, vector) in enumerate(zip(chunks, vectors)):
            vector_id = f"doc_{uuid.uuid4().hex[:8]}_{idx}"
            upsert_data.append((
                vector_id,
                vector,
                {"text": chunk, "source": source_name}
            ))
            
        index.upsert(vectors=upsert_data)
        
        print("\n" + "=" * 60)
        print(" SUCCESS: Chunks successfully uploaded to Pinecone database!")
        print("=" * 60)
        
    except Exception as e:
        print(f"\nERROR occurred during ingestion: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
