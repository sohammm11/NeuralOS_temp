from fastapi import FastAPI, HTTPException, Depends, Header, Request, Response, Cookie
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
import app.config as config
from app.rag import query_rag, query_rag_stream, llm, embeddings, index
import json
import asyncio
from app.notion_connector import get_notion_pages, chunk_and_prepare
from app.slack_connector import get_slack_messages, chunk_slack_messages
from app.graph import seed_swiftmove_graph, get_all_nodes, graph_enabled, init_graph
from app.workflows import detect_intent, create_notion_task
from app.gmail_connector import get_gmail_messages, chunk_emails
from app.feedback import add_correction, add_good_answer, get_feedback_stats
from app.agent import execute_agent
from app.database import init_db, db_enabled, get_company_by_api_key, log_action, save_feedback as db_save_feedback, get_corrections, get_feedback_stats as db_feedback_stats, log_sync, get_sync_history, get_pending_actions, update_action_status, get_action_by_id
import secrets
import hashlib
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import logging
from datetime import datetime

# Rate limiting
limiter = Limiter(key_func=get_remote_address)

from fastapi.openapi.models import APIKey
from fastapi.security import APIKeyHeader

api_key_header = APIKeyHeader(name="X-Api-Key", auto_error=False)

app = FastAPI(
    title="NeuralOS RAG Backend",
    description="Minimal FastAPI backend to query knowledge database built on Slack + Notion",
    version="1.0"
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Audit Logging setup
logging.basicConfig(
    filename='neuralos_audit.log',
    level=logging.INFO,
    format='%(asctime)s - %(message)s'
)

def audit_log(action: str, details: str, company_id: str = "unknown"):
    logging.info(f"ACTION={action} | COMPANY={company_id} | DETAILS={details}")
    if db_enabled:
        log_action(company_id, action, details)

def verify_api_key(
    x_api_key: str = Depends(api_key_header),
    cookie_key: str = Cookie(None, alias="neuralos_api_key")
):
    key = x_api_key or cookie_key
    if not key:
        raise HTTPException(
            status_code=401,
            detail="API key required. Add X-Api-Key header or login cookie."
        )
    company = get_company_by_api_key(key)
    if not company:
        raise HTTPException(
            status_code=403,
            detail="Invalid API key."
        )
    return company

class RegisterRequest(BaseModel):
    company_name: str

@app.post("/api/register")
async def register_company(request: RegisterRequest, response: Response):
    try:
        from app.database import create_company
        if not request.company_name.strip():
            raise HTTPException(status_code=400, detail="Company name required.")
        result = create_company(request.company_name)

        response.set_cookie(
            key="neuralos_api_key",
            value=result["api_key"],
            httponly=True,
            samesite="lax",
            max_age=60 * 60 * 24 * 365
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def sanitize_input(text: str) -> str:
    # Remove prompt injection attempts
    dangerous_patterns = [
        "ignore previous instructions",
        "ignore all instructions",
        "you are now",
        "forget your instructions",
        "new instructions:",
        "system prompt:",
    ]
    text_lower = text.lower()
    for pattern in dangerous_patterns:
        if pattern in text_lower:
            raise HTTPException(
                status_code=400,
                detail="Invalid input detected."
            )
    # Limit input length
    if len(text) > 2000:
        raise HTTPException(
            status_code=400,
            detail="Input too long. Maximum 2000 characters."
        )
    return text.strip()

init_graph()
config.validate_config()


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
    request.question = sanitize_input(request.question)
    audit_log("CHAT", f"question={request.question[:50]}")
    try:
        result = query_rag(request.question, request.history)
        return ChatResponse(
            answer=result["answer"],
            sources=result["sources"]
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/chat/stream")
@limiter.limit("30/minute")
async def chat_stream_endpoint(
    request: Request,
    body: ChatRequest,
    company: dict = Depends(verify_api_key)
):
    body.question = sanitize_input(body.question)
    company_id = str(company["_id"])
    audit_log("CHAT", f"question={body.question[:50]}", company_id)
    if not body.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    async def generate():
        try:
            namespace = company.get("pinecone_namespace", "default")
            async for chunk in query_rag_stream(body.question, body.history, namespace):
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
async def get_insights(company: dict = Depends(verify_api_key)):
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
async def sync_notion(
    request: SyncRequest,
    company: dict = Depends(verify_api_key)
):
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

            index.upsert(vectors=upsert_data, namespace="swiftmove_logistics")
            total_upserted += len(batch)

        if db_enabled:
            log_sync(
                company_id="demo",
                source="notion",
                items_synced=len(pages),
                chunks_indexed=total_upserted
            )
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

class SlackSyncRequest(BaseModel):
    slack_token: str
    gemini_key: str
    pinecone_key: str
    pinecone_index: str

@app.post("/api/sync/slack")
async def sync_slack(
    request: SlackSyncRequest,
    company: dict = Depends(verify_api_key)
):
    try:
        # Use backend keys if managed
        gemini_key = request.gemini_key
        pinecone_key = request.pinecone_key

        if gemini_key == 'neuralos_managed' or not gemini_key:
            gemini_key = config.GEMINI_API_KEY
        if pinecone_key == 'neuralos_managed' or not pinecone_key:
            pinecone_key = config.PINECONE_API_KEY

        # 1. Fetch Slack messages
        channels = get_slack_messages(request.slack_token)

        if not channels:
            return {
                "success": False,
                "message": "No channels found. Check your Slack token and bot permissions."
            }

        # 2. Chunk messages
        chunks = chunk_slack_messages(channels)

        # 3. Embed and store
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
                    "id": f"slack_{chunk['channel']}_{chunk['chunk_index']}",
                    "values": vector,
                    "metadata": {
                        "text": chunk["text"],
                        "source": chunk["source"]
                    }
                })

            index.upsert(vectors=upsert_data, namespace="swiftmove_logistics")
            total_upserted += len(batch)

        if db_enabled:
            log_sync(
                company_id="demo",
                source="slack",
                items_synced=len(channels),
                chunks_indexed=total_upserted
            )
        return {
            "success": True,
            "message": f"Synced {len(channels)} channels, indexed {total_upserted} chunks.",
            "channels": [c["channel"] for c in channels],
            "channels_count": len(channels),
            "chunks_count": total_upserted
        }

    except Exception as e:
        return {
            "success": False,
            "message": str(e)
        }

@app.post("/api/graph/seed")
async def seed_graph():
    try:
        result = seed_swiftmove_graph()
        if result:
            return {"success": True, "message": "Knowledge graph seeded successfully."}
        else:
            return {"success": False, "message": "Failed to seed graph."}
    except Exception as e:
        return {"success": False, "message": str(e)}

@app.get("/api/graph/nodes")
async def get_graph_nodes():
    try:
        nodes = get_all_nodes()
        return {"success": True, "nodes": nodes}
    except Exception as e:
        return {"success": False, "nodes": [], "message": str(e)}

class WorkflowRequest(BaseModel):
    message: str
    notion_token: str = None
    slack_token: str = None

@app.post("/api/workflow")
async def run_workflow(request: WorkflowRequest):
    try:
        intent, details = detect_intent(request.message)

        if intent == "CREATE_TASK":
            if not request.notion_token:
                return {
                    "success": False,
                    "intent": intent,
                    "message": "Notion token required to create tasks."
                }

            result = create_notion_task(
                notion_token=request.notion_token,
                task_title=details.get("title", request.message),
                assignee=details.get("assignee"),
                notes=request.message
            )

            return {
                "success": result["success"],
                "intent": intent,
                "message": result["message"],
                "url": result.get("url", "")
            }

        elif intent == "SEND_SLACK":
            if not request.slack_token:
                return {
                    "success": False,
                    "intent": intent,
                    "message": "Slack token required to send messages."
                }

            from app.workflows import send_slack_message
            result = send_slack_message(
                slack_token=request.slack_token,
                channel=details.get("channel", "general"),
                message=details.get("message", request.message)
            )

            return {
                "success": result["success"],
                "intent": intent,
                "message": result["message"]
            }

        return {
            "success": False,
            "intent": "QUESTION",
            "message": "This looks like a question, not an action."
        }

    except Exception as e:
        return {
            "success": False,
            "intent": "ERROR",
            "message": str(e)
        }

@app.post("/api/sync/gmail")
async def sync_gmail():
    try:
        # 1. Fetch emails
        emails = get_gmail_messages(max_emails=10)

        if not emails:
            return {
                "success": False,
                "message": "No emails found or authentication failed."
            }

        # 2. Chunk emails
        chunks = chunk_emails(emails)

        # 3. Embed and store
        from langchain_google_genai import GoogleGenerativeAIEmbeddings
        from pinecone import Pinecone

        embeddings = GoogleGenerativeAIEmbeddings(
            model="models/gemini-embedding-001",
            google_api_key=config.GEMINI_API_KEY,
            output_dimensionality=768
        )

        pc = Pinecone(api_key=config.PINECONE_API_KEY)
        index = pc.Index(config.PINECONE_INDEX_NAME)

        # 4. Upsert in batches
        batch_size = 50
        total_upserted = 0

        for i in range(0, len(chunks), batch_size):
            import asyncio
            await asyncio.sleep(3)
            batch = chunks[i:i + batch_size]
            texts = [c["text"] for c in batch]
            vectors = embeddings.embed_documents(texts)

            upsert_data = []
            for j, (chunk, vector) in enumerate(zip(batch, vectors)):
                upsert_data.append({
                    "id": f"gmail_{i}_{j}",
                    "values": vector,
                    "metadata": {
                        "text": chunk["text"],
                        "source": chunk["source"]
                    }
                })

            index.upsert(vectors=upsert_data, namespace="swiftmove_logistics")
            total_upserted += len(batch)

        return {
            "success": True,
            "message": f"Synced {len(emails)} emails, indexed {total_upserted} chunks.",
            "count": len(emails)
        }

    except Exception as e:
        return {
            "success": False,
            "message": str(e)
        }

class FeedbackRequest(BaseModel):
    question: str
    answer: str
    feedback_type: str
    correction: str = None

@app.post("/api/feedback")
async def submit_feedback(
    request: FeedbackRequest,
    company: dict = Depends(verify_api_key)
):
    try:
        company_id = str(company["_id"])
        db_save_feedback(
            company_id=company_id,
            question=request.question,
            answer=request.answer,
            feedback_type=request.feedback_type,
            correction=request.correction
        )
        if request.feedback_type == "good":
            return {"success": True, "message": "Thanks for the feedback!"}
        return {"success": True, "message": "Correction saved. NeuralOS will improve."}
    except Exception as e:
        return {"success": False, "message": str(e)}

@app.get("/api/feedback/stats")
async def feedback_stats(company: dict = Depends(verify_api_key)):
    company_id = str(company["_id"])
    return db_feedback_stats(company_id)

class AgentRequest(BaseModel):
    instruction: str
    notion_token: str = None
    slack_token: str = None

@app.post("/api/agent")
@limiter.limit("10/minute")
async def run_agent(
    request: Request,
    body: AgentRequest,
    company: dict = Depends(verify_api_key)
):
    company_id = str(company["_id"])
    audit_log("AGENT", f"instruction={body.instruction[:50]}", company_id)
    async def generate():
        try:
            async for chunk in execute_agent(
                instruction=body.instruction,
                llm=llm,
                embeddings=embeddings,
                index=index,
                notion_token=body.notion_token,
                slack_token=body.slack_token,
                company_id=str(company["_id"])
            ):
                yield f"data: {json.dumps(chunk)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no"
        }
    )

@app.get("/api/actions/pending")
async def list_pending_actions(company: dict = Depends(verify_api_key)):
    try:
        company_id = str(company["_id"])
        actions = get_pending_actions(company_id)
        return {"success": True, "actions": actions}
    except Exception as e:
        return {"success": False, "actions": [], "message": str(e)}


class ActionDecisionRequest(BaseModel):
    action_id: str

@app.post("/api/actions/approve")
async def approve_action(
    request: ActionDecisionRequest,
    company: dict = Depends(verify_api_key)
):
    try:
        action = get_action_by_id(request.action_id)
        if not action:
            return {"success": False, "message": "Action not found."}

        if action["status"] != "pending":
            return {"success": False, "message": "Action already resolved."}

        details = action["details"]
        action_type = action["action_type"]
        result_message = ""

        if action_type == "SEND_SLACK":
            from app.workflows import send_slack_message
            result = send_slack_message(
                slack_token=details["slack_token"],
                channel=details["channel"],
                message=details["message"]
            )
            result_message = result["message"]

        elif action_type == "CREATE_TASK":
            from app.workflows import create_notion_task
            result = create_notion_task(
                notion_token=details["notion_token"],
                task_title=details["title"],
                assignee=details.get("assignee"),
                notes=details.get("notes", "")
            )
            result_message = result["message"]

        update_action_status(request.action_id, "approved")
        audit_log("ACTION_APPROVED", f"type={action_type}", str(company["_id"]))

        return {"success": True, "message": result_message}

    except Exception as e:
        return {"success": False, "message": str(e)}


@app.post("/api/actions/reject")
async def reject_action(
    request: ActionDecisionRequest,
    company: dict = Depends(verify_api_key)
):
    try:
        update_action_status(request.action_id, "rejected")
        audit_log("ACTION_REJECTED", f"action_id={request.action_id}", str(company["_id"]))
        return {"success": True, "message": "Action rejected and discarded."}
    except Exception as e:
        return {"success": False, "message": str(e)}


@app.get("/api/health")
async def health_check():
    return {"status": "healthy"}