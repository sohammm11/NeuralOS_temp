from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List
import app.config as config
from app.rag import query_rag, query_rag_stream
import json
import asyncio
from app.notion_connector import get_notion_pages, chunk_and_prepare

config.validate_config()


app = FastAPI(
    title="NeuralOS RAG Backend",
    description="Minimal FastAPI backend to query knowledge database built on Slack + Notion",
    version="1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Message(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    question: str
    history: List[Message] = []

class ChatResponse(BaseModel):
    answer: str
    sources: List[str]

@app.post("/api/chat", response_model=ChatResponse)
async def chat_endpoint(request: ChatRequest):
    if not request.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")
    try:
        result = query_rag(request.question, request.history)
        return ChatResponse(
            answer=result["answer"],
            sources=result["sources"]
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/chat/stream")
async def chat_stream_endpoint(request: ChatRequest):
    if not request.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    async def generate():
        try:
            async for chunk in query_rag_stream(request.question, request.history):
                yield f"data: {json.dumps(chunk)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no"
        }
    )

@app.get("/api/insights")
async def get_insights():
    insight_queries = [
        {
            "id": "client_risk",
            "query": "Which clients are at risk and why? What are the SLA terms and recent issues?",
            "label": "Client risk analysis"
        },
        {
            "id": "pending_actions",
            "query": "What action items and tasks are pending or overdue? Who are the owners?",
            "label": "Pending action items"
        },
        {
            "id": "tech_risks",
            "query": "What are the current technical risks and known problems in the system?",
            "label": "Technical risks"
        },
    ]

    results = []
    for item in insight_queries:
        try:
            await asyncio.sleep(5)
            result = query_rag(item["query"], [])
            results.append({
                "id": item["id"],
                "label": item["label"],
                "answer": result["answer"],
                "sources": result["sources"]
            })
        except Exception as e:
            results.append({
                "id": item["id"],
                "label": item["label"],
                "answer": f"Could not load insight: {str(e)}",
                "sources": []
            })

    return {"insights": results}

class InitializeRequest(BaseModel):
    company: str
    gemini_key: str
    pinecone_key: str
    pinecone_index: str

@app.post("/api/initialize")
async def initialize(request: InitializeRequest):
    try:
        from langchain_google_genai import GoogleGenerativeAIEmbeddings
        from pinecone import Pinecone

        embeddings = GoogleGenerativeAIEmbeddings(
            model="models/gemini-embedding-001",
            google_api_key=request.gemini_key,
            output_dimensionality=768
        )
        test_embed = embeddings.embed_query("test")

        pc = Pinecone(api_key=request.pinecone_key)
        indexes = [idx.name for idx in pc.list_indexes()]

        if request.pinecone_index not in indexes:
            return {
                "success": False,
                "message": f"Pinecone index '{request.pinecone_index}' not found."
            }

        return {
            "success": True,
            "message": f"Brain initialized for {request.company}"
        }
    except Exception as e:
        return {
            "success": False,
            "message": f"Invalid keys: {str(e)}"
        }

class SyncRequest(BaseModel):
    notion_token: str
    gemini_key: str
    pinecone_key: str
    pinecone_index: str

@app.post("/api/sync/notion")
async def sync_notion(request: SyncRequest):
    try:
        # Use backend config keys if managed
        gemini_key = request.gemini_key
        pinecone_key = request.pinecone_key

        if gemini_key == 'neuralos_managed' or not gemini_key:
            gemini_key = config.GEMINI_API_KEY
        if pinecone_key == 'neuralos_managed' or not pinecone_key:
            pinecone_key = config.PINECONE_API_KEY

        # 1. Fetch all Notion pages
        pages = get_notion_pages(request.notion_token)
        
        if not pages:
            return {
                "success": False,
                "message": "No pages found. Make sure you connected pages to the integration."
            }
        
        # 2. Chunk the content
        chunks = chunk_and_prepare(pages)
        
        # 3. Embed and store in Pinecone
        from langchain_google_genai import GoogleGenerativeAIEmbeddings
        from pinecone import Pinecone

        embeddings = GoogleGenerativeAIEmbeddings(
            model="models/gemini-embedding-001",
            google_api_key=gemini_key,
            output_dimensionality=768
        )

        pc = Pinecone(api_key=pinecone_key)
        index = pc.Index(request.pinecone_index)

        # 4. Upsert in batches
        batch_size = 50
        total_upserted = 0

        for i in range(0, len(chunks), batch_size):
            batch = chunks[i:i + batch_size]
            texts = [c["text"] for c in batch]
            vectors = embeddings.embed_documents(texts)

            upsert_data = []
            for j, (chunk, vector) in enumerate(zip(batch, vectors)):
                upsert_data.append({
                    "id": f"notion_{chunk['page_id']}_{chunk['chunk_index']}",
                    "values": vector,
                    "metadata": {
                        "text": chunk["text"],
                        "source": chunk["source"]
                    }
                })

            index.upsert(vectors=upsert_data)
            total_upserted += len(batch)

        return {
            "success": True,
            "message": f"Synced {len(pages)} pages, indexed {total_upserted} chunks.",
            "pages": [p["title"] for p in pages]
        }

    except Exception as e:
        return {
            "success": False,
            "message": str(e)
        }

@app.get("/api/health")
async def health_check():
    return {"status": "healthy"}