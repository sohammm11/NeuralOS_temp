from fastapi import FastAPI, HTTPException, Depends, Header, Request, Response, Cookie, File, UploadFile, Form
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
from app.drive_connector import get_drive_files, chunk_drive_files
from app.feedback import add_correction, add_good_answer, get_feedback_stats
from app.agent import execute_agent
from app.database import init_db, db_enabled, get_company_by_api_key, log_action, save_feedback as db_save_feedback, get_corrections, get_feedback_stats as db_feedback_stats, log_sync, get_sync_history, get_pending_actions, update_action_status, get_action_by_id, create_user, verify_user, create_jwt_token, decode_jwt_token
from app.pii_detector import scan_chunks
from app.encryption import encrypt_chunks
from app.anomaly import analyze_company
from app.database import create_alert, get_active_alerts, resolve_alert
from app.database import create_session, get_sessions, get_session, append_message, update_session_title, delete_session
from app.deep_research import deep_synthesize_generator
import secrets
import hashlib
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import logging
from datetime import datetime
from app.scheduler import start_scheduler, stop_scheduler

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
        "http://localhost:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup_event():
    start_scheduler(index, embeddings, llm)

@app.on_event("shutdown")
async def shutdown_event():
    stop_scheduler()

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
async def chat_endpoint(
    request: ChatRequest,
    company: dict = Depends(verify_api_key)
):
    if not request.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")
    request.question = sanitize_input(request.question)
    company_id = str(company["_id"])
    namespace = company.get("pinecone_namespace", "default")
    audit_log("CHAT", f"question={request.question[:50]}", company_id)
    try:
        result = query_rag(request.question, request.history, namespace, company_id)
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
    print(f"COMPANY DOC: _id={str(company['_id'])} name={company.get('name')} ns={company.get('pinecone_namespace')}")
    company_id = str(company["_id"])
    audit_log("CHAT", f"question={body.question[:50]}", company_id)
    if not body.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    async def generate():
        try:
            namespace = company.get("pinecone_namespace", "default")
            async for chunk in query_rag_stream(body.question, body.history, namespace, company_id):
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

class DeepResearchRequest(BaseModel):
    question: str

@app.post("/api/research/deep")
@limiter.limit("15/minute")
async def deep_research_endpoint(
    request: Request,
    body: DeepResearchRequest,
    company: dict = Depends(verify_api_key)
):
    question = sanitize_input(body.question)
    if not question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")
    
    company_id = str(company["_id"])
    namespace = company.get("pinecone_namespace", "default")
    audit_log("DEEP_RESEARCH", f"question={question[:50]}", company_id)

    async def generate():
        try:
            async for step_event in deep_synthesize_generator(question, namespace, company_id):
                yield f"data: {json.dumps(step_event)}\n\n"
        except Exception as e:
            print(f"[Deep Research Endpoint] Error: {e}")
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
    company_id = str(company["_id"])
    namespace = company.get("pinecone_namespace", "default")
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
            result = query_rag(item["query"], [], namespace, company_id)
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
        from app.gemini_http import HTTPGoogleGenerativeAIEmbeddings
        from pinecone import Pinecone

        embeddings = HTTPGoogleGenerativeAIEmbeddings(
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
        company_id = str(company["_id"])
        namespace = company.get("pinecone_namespace", "default")
        
        # Store token for auto-sync
        if request.notion_token and request.notion_token != "neuralos_managed":
            from app.database import db
            db.companies.update_one(
                {"_id": company["_id"]},
                {"$set": {"tokens.notion_token": request.notion_token}}
            )

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
        chunks, pii_report = scan_chunks(chunks)
        if pii_report["chunks_with_pii"] > 0:
            print(f"PII detected and redacted in Notion sync: {pii_report['findings']}")
        chunks = encrypt_chunks(chunks, company_id)
        print(f"DEBUG: Encrypted {len(chunks)} chunks for company {company_id}")
        
        # 3. Embed and store in Pinecone
        from app.gemini_http import HTTPGoogleGenerativeAIEmbeddings
        from pinecone import Pinecone

        embeddings = HTTPGoogleGenerativeAIEmbeddings(
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
                        "source": chunk["source"],
                        "encrypted": chunk.get("encrypted", False)
                    }
                })

            index.upsert(vectors=upsert_data, namespace=namespace)
            total_upserted += len(batch)

        if db_enabled:
            log_sync(
                company_id=company_id,
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
        company_id = str(company["_id"])
        namespace = company.get("pinecone_namespace", "default")
        
        # Store token for auto-sync
        if request.slack_token and request.slack_token != "neuralos_managed":
            from app.database import db
            db.companies.update_one(
                {"_id": company["_id"]},
                {"$set": {"tokens.slack_token": request.slack_token}}
            )

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
        chunks, pii_report = scan_chunks(chunks)
        if pii_report["chunks_with_pii"] > 0:
            print(f"PII detected and redacted in Slack sync: {pii_report['findings']}")
        chunks = encrypt_chunks(chunks, company_id)

        # 3. Embed and store
        from app.gemini_http import HTTPGoogleGenerativeAIEmbeddings
        from pinecone import Pinecone

        embeddings = HTTPGoogleGenerativeAIEmbeddings(
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
                        "source": chunk["source"],
                        "encrypted": chunk.get("encrypted", False)
                    }
                })

            index.upsert(vectors=upsert_data, namespace=namespace)
            total_upserted += len(batch)

        if db_enabled:
            log_sync(
                company_id=company_id,
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
async def seed_graph(company: dict = Depends(verify_api_key)):
    try:
        company_id = str(company["_id"])
        result = seed_swiftmove_graph(company_id)
        if result:
            return {"success": True, "message": "Knowledge graph seeded successfully."}
        else:
            return {"success": False, "message": "Failed to seed graph."}
    except Exception as e:
        return {"success": False, "message": str(e)}

@app.get("/api/graph/nodes")
async def get_graph_nodes(company: dict = Depends(verify_api_key)):
    try:
        company_id = str(company["_id"])
        nodes = get_all_nodes(company_id)
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
async def sync_gmail(company: dict = Depends(verify_api_key)):
    try:
        company_id = str(company["_id"])
        namespace = company.get("pinecone_namespace", "default")
        # 1. Fetch emails
        emails = get_gmail_messages(max_emails=10)

        if not emails:
            return {
                "success": False,
                "message": "No emails found or authentication failed."
            }

        # 2. Chunk emails
        chunks = chunk_emails(emails)
        chunks, pii_report = scan_chunks(chunks)
        if pii_report["chunks_with_pii"] > 0:
            print(f"PII detected and redacted in Gmail sync: {pii_report['findings']}")
        chunks = encrypt_chunks(chunks, company_id)

        # 3. Embed and store
        from app.gemini_http import HTTPGoogleGenerativeAIEmbeddings
        from pinecone import Pinecone

        embeddings = HTTPGoogleGenerativeAIEmbeddings(
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
                        "source": chunk["source"],
                        "encrypted": chunk.get("encrypted", False)
                    }
                })

            index.upsert(vectors=upsert_data, namespace=namespace)
            total_upserted += len(batch)

        if db_enabled:
            log_sync(company_id, "gmail", len(emails), total_upserted)

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
@app.post("/api/sync/drive")
async def sync_drive(company: dict = Depends(verify_api_key)):
    try:
        company_id = str(company["_id"])
        namespace = company.get("pinecone_namespace", "default")
        files = get_drive_files(max_files=15)

        if not files:
            return {"success": False, "message": "No Drive files found or authentication failed."}

        chunks = chunk_drive_files(files)
        chunks, pii_report = scan_chunks(chunks)
        if pii_report["chunks_with_pii"] > 0:
            print(f"PII detected and redacted in Drive sync: {pii_report['findings']}")
        chunks = encrypt_chunks(chunks, company_id)

        from app.gemini_http import HTTPGoogleGenerativeAIEmbeddings
        embeddings = HTTPGoogleGenerativeAIEmbeddings(
            model="models/gemini-embedding-001",
            google_api_key=config.GEMINI_API_KEY,
            output_dimensionality=768
        )


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
                    "id": f"drive_{i}_{j}",
                    "values": vector,
                    "metadata": {
                        "text": chunk["text"],
                        "source": chunk["source"],
                        "encrypted": chunk.get("encrypted", False)
                    }
                })

            index.upsert(vectors=upsert_data, namespace=namespace)
            total_upserted += len(batch)

        if db_enabled:
            log_sync(str(company["_id"]), "drive", len(files), total_upserted)

        return {
            "success": True,
            "message": f"Synced {len(files)} files, indexed {total_upserted} chunks."
        }

    except Exception as e:
        return {"success": False, "message": str(e)}

@app.get("/api/sync/status")
async def sync_status(company: dict = Depends(verify_api_key)):
    try:
        company_id = str(company["_id"])
        history = get_sync_history(company_id)
        return {"success": True, "history": history}
    except Exception as e:
        return {"success": False, "history": [], "message": str(e)}

class SignupRequest(BaseModel):
    email: str
    password: str
    name: str = ""

class LoginRequest(BaseModel):
    email: str
    password: str

@app.post("/api/auth/signup")
async def signup(request: SignupRequest, response: Response, company: dict = Depends(verify_api_key)):
    try:
        result = create_user(
            company_id=str(company["_id"]),
            email=request.email,
            password=request.password,
            name=request.name
        )
        if not result["success"]:
            raise HTTPException(status_code=400, detail=result["message"])

        token = create_jwt_token(result["user_id"], str(company["_id"]), request.email)
        response.set_cookie(
            key="neuralos_user_token",
            value=token,
            httponly=True,
            samesite="lax",
            max_age=60 * 60 * 24 * 7
        )
        return {"success": True, "message": "Account created."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/auth/login")
async def login(request: LoginRequest, response: Response):
    user = verify_user(request.email, request.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    token = create_jwt_token(str(user["_id"]), str(user["company_id"]), user["email"])
    response.set_cookie(
        key="neuralos_user_token",
        value=token,
        httponly=True,
        samesite="lax",
        max_age=60 * 60 * 24 * 7
    )
    return {"success": True, "message": "Logged in.", "name": user.get("name", "")}

@app.get("/api/auth/me")
async def get_current_user(neuralos_user_token: str = Cookie(None)):
    if not neuralos_user_token:
        raise HTTPException(status_code=401, detail="Not logged in.")
    payload = decode_jwt_token(neuralos_user_token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired session.")
    return {"success": True, "email": payload["email"], "company_id": payload["company_id"]}

@app.post("/api/auth/logout")
async def logout(response: Response):
    response.delete_cookie("neuralos_api_key")
    response.delete_cookie("neuralos_user_token")
    return {"success": True, "message": "Logged out."}


# ============================================
# CHAT SESSIONS ENDPOINTS
# ============================================

class CreateSessionRequest(BaseModel):
    title: str = "New chat"

@app.post("/api/sessions")
async def create_chat_session(
    request: CreateSessionRequest,
    company: dict = Depends(verify_api_key),
    neuralos_user_token: str = Cookie(None)
):
    try:
        company_id = str(company["_id"])
        user_id = "default"
        if neuralos_user_token:
            payload = decode_jwt_token(neuralos_user_token)
            if payload:
                user_id = payload.get("user_id", "default")
        
        session_id = create_session(company_id, user_id, request.title)
        return {"success": True, "session_id": session_id}
    except Exception as e:
        return {"success": False, "message": str(e)}

@app.get("/api/sessions")
async def list_sessions(
    company: dict = Depends(verify_api_key),
    neuralos_user_token: str = Cookie(None)
):
    try:
        company_id = str(company["_id"])
        user_id = "default"
        if neuralos_user_token:
            payload = decode_jwt_token(neuralos_user_token)
            if payload:
                user_id = payload.get("user_id", "default")
        
        sessions = get_sessions(company_id, user_id)
        return {"success": True, "sessions": sessions}
    except Exception as e:
        return {"success": False, "sessions": [], "message": str(e)}

@app.get("/api/sessions/{session_id}")
async def get_chat_session(
    session_id: str,
    company: dict = Depends(verify_api_key)
):
    try:
        session = get_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found.")
        return {"success": True, "session": session}
    except Exception as e:
        return {"success": False, "message": str(e)}

class AppendMessageRequest(BaseModel):
    session_id: str
    role: str
    content: str
    sources: list = []
    reasoning: list = []

@app.post("/api/sessions/message")
async def add_message_to_session(
    request: AppendMessageRequest,
    company: dict = Depends(verify_api_key)
):
    try:
        append_message(
            request.session_id,
            request.role,
            request.content,
            request.sources,
            request.reasoning
        )
        return {"success": True}
    except Exception as e:
        return {"success": False, "message": str(e)}

class UpdateTitleRequest(BaseModel):
    session_id: str
    title: str

@app.patch("/api/sessions/title")
async def update_title(
    request: UpdateTitleRequest,
    company: dict = Depends(verify_api_key)
):
    try:
        update_session_title(request.session_id, request.title)
        return {"success": True}
    except Exception as e:
        return {"success": False, "message": str(e)}

@app.delete("/api/sessions/{session_id}")
async def delete_chat_session(
    session_id: str,
    company: dict = Depends(verify_api_key)
):
    try:
        delete_session(session_id)
        return {"success": True}
    except Exception as e:
        return {"success": False, "message": str(e)}


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
    notion_token: Optional[str] = None
    slack_token: Optional[str] = None

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


# ============================================
# MEETING INTELLIGENCE ENDPOINTS
# ============================================

@app.post("/api/meetings/process")
async def process_meeting(
    request: Request,
    company: dict = Depends(verify_api_key)
):
    """
    Process a meeting transcript and extract structured information.
    Accepts: {"transcript": "string"} or uploaded file
    """
    try:
        # Check if it's a file upload or JSON body
        content_type = request.headers.get("content-type", "")
        
        if "multipart/form-data" in content_type:
            # File upload
            form = await request.form()
            file = form.get("file")
            if not file:
                raise HTTPException(status_code=400, detail="No file provided")
            
            transcript = await file.read()
            transcript = transcript.decode("utf-8", errors="ignore")
        else:
            # JSON body
            body = await request.json()
            transcript = body.get("transcript", "")
        
        if not transcript or len(transcript.strip()) < 50:
            raise HTTPException(status_code=400, detail="Transcript too short (min 50 characters)")
        
        # Size limit: 50KB
        if len(transcript) > 50000:
            raise HTTPException(status_code=400, detail="Transcript too large (max 50KB)")
        
        print(f"[Meeting] Processing transcript ({len(transcript)} chars)")
        
        # Call Gemini with structured prompt using pre-configured llm
        from app.meeting_prompts import MEETING_EXTRACTION_PROMPT, MEETING_JSON_FIX_PROMPT
        
        # First attempt
        prompt = MEETING_EXTRACTION_PROMPT.replace("{transcript}", transcript)
        response = llm.invoke(prompt)
        response_text = response.content.strip()
        
        # Try to parse JSON
        import json
        import re
        extracted_data = None
        
        print(f"[Meeting] Raw Gemini response (first 200 chars): {response_text[:200]}")
        print(f"[Meeting] Raw response length: {len(response_text)}")
        
        for attempt in range(2):
            try:
                # Remove markdown code blocks
                # Pattern: ```json ... ``` or ``` ... ```
                code_block_match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', response_text, re.DOTALL)
                if code_block_match:
                    response_text = code_block_match.group(1)
                elif response_text.startswith("```"):
                    # Fallback: just strip backticks
                    response_text = response_text.strip('`')
                    if response_text.startswith("json"):
                        response_text = response_text[4:]
                    response_text = response_text.strip()
                
                # Try to find JSON object if there's extra text
                if not response_text.startswith("{"):
                    json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
                    if json_match:
                        response_text = json_match.group(0)
                
                print(f"[Meeting] Cleaned response (first 200 chars): {response_text[:200]}")
                extracted_data = json.loads(response_text)
                break
            except json.JSONDecodeError as e:
                print(f"[Meeting] JSON parse failed (attempt {attempt + 1}): {e}")
                print(f"[Meeting] Failed text (first 500 chars): {response_text[:500]}")
                if attempt == 0:
                    # Retry with fix-up prompt
                    fix_response = llm.invoke(
                        MEETING_JSON_FIX_PROMPT + "\n\nPrevious response:\n" + response_text
                    )
                    response_text = fix_response.content.strip()
                else:
                    raise HTTPException(
                        status_code=500,
                        detail=f"Failed to parse JSON. Raw response: {response_text[:200]}"
                    )
        
        # Validate structure
        if not isinstance(extracted_data, dict):
            raise HTTPException(status_code=500, detail="Invalid response structure")
        
        # Ensure all required keys exist
        extracted_data.setdefault("metadata", {})
        extracted_data.setdefault("decisions", [])
        extracted_data.setdefault("action_items", [])
        extracted_data.setdefault("open_questions", [])
        
        print(f"[Meeting] Extracted: {len(extracted_data.get('decisions', []))} decisions, "
              f"{len(extracted_data.get('action_items', []))} action items, "
              f"{len(extracted_data.get('open_questions', []))} questions")
        
        return {
            "success": True,
            "data": extracted_data,
            "stats": {
                "decisions": len(extracted_data.get("decisions", [])),
                "action_items": len(extracted_data.get("action_items", [])),
                "open_questions": len(extracted_data.get("open_questions", []))
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Meeting] Error processing transcript: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Processing failed: {str(e)}")


@app.post("/api/meetings/create-tasks")
async def create_meeting_tasks(
    request: Request,
    company: dict = Depends(verify_api_key)
):
    """
    Create Notion tasks from meeting action items.
    Accepts: {"action_items": [...], "meeting_title": "string", "notion_token": "string or null"}
    """
    try:
        body = await request.json()
        action_items = body.get("action_items", [])
        meeting_title = body.get("meeting_title", "Meeting")
        notion_token = body.get("notion_token")
        
        if not action_items:
            raise HTTPException(status_code=400, detail="No action items provided")
        
        company_id = str(company["_id"])
        
        print(f"[Meeting] Creating {len(action_items)} tasks from '{meeting_title}'")
        
        # Create pending actions in MongoDB
        from app.database import create_pending_action
        
        created_task_ids = []
        for item in action_items:
            # Build task title
            task_name = item.get("task", "Untitled task")
            assignee = item.get("assignee")
            due_date = item.get("due_date")
            
            if assignee:
                title = f"{assignee}: {task_name}"
            else:
                title = task_name
            
            # Build context
            context = item.get("context", "")
            if due_date:
                context += f"\n\nDue: {due_date}"
            context += f"\n\nSource: {meeting_title}"
            
            # Create pending action
            action_id = create_pending_action(
                company_id=company_id,
                action_type="CREATE_TASK",
                details={
                    "title": title,
                    "assignee": assignee,
                    "notes": context,
                    "notion_token": notion_token
                }
            )
            
            created_task_ids.append(action_id)
        
        print(f"[Meeting] Created {len(created_task_ids)} pending tasks")
        
        return {
            "success": True,
            "created_count": len(created_task_ids),
            "task_ids": created_task_ids,
            "message": f"Created {len(created_task_ids)} tasks. Approve them in the Workflows tab."
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Meeting] Error creating tasks: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Task creation failed: {str(e)}")


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

        return {
            "success": True, 
            "message": result_message,
            "url": result.get("url", "")
        }

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


@app.post("/api/anomaly/scan")
async def run_anomaly_scan(company: dict = Depends(verify_api_key)):
    try:
        company_id = str(company["_id"])
        namespace = company.get("pinecone_namespace", "swiftmove_logistics")
        print(f"DEBUG: company={company.get('name')} namespace={namespace}")
        
        alerts = analyze_company(
            company_id=company_id,
            index=index,
            embeddings=embeddings,
            namespace=namespace
        )
        return {
            "success": True,
            "alerts_found": len(alerts),
            "message": f"Scan complete. {len(alerts)} anomalies detected."
        }
    except Exception as e:
        return {"success": False, "message": str(e)}

@app.get("/api/alerts")
async def get_alerts(company: dict = Depends(verify_api_key)):
    try:
        company_id = str(company["_id"])
        alerts = get_active_alerts(company_id)
        return {"success": True, "alerts": alerts}
    except Exception as e:
        return {"success": False, "alerts": [], "message": str(e)}

class ResolveAlertRequest(BaseModel):
    alert_id: str

@app.post("/api/alerts/resolve")
async def resolve_alert_endpoint(
    request: ResolveAlertRequest,
    company: dict = Depends(verify_api_key)
):
    try:
        resolve_alert(request.alert_id)
        return {"success": True, "message": "Alert resolved."}
    except Exception as e:
        return {"success": False, "message": str(e)}


@app.get("/api/graph/relationships")
async def get_graph_relationships_endpoint(company: dict = Depends(verify_api_key)):
    try:
        from app.database import get_graph_relationships
        company_id = str(company["_id"])
        relationships = get_graph_relationships(company_id)
        return {"success": True, "relationships": relationships}
    except Exception as e:
        return {"success": False, "relationships": [], "message": str(e)}


@app.get("/api/graph/data")
async def get_graph_data(company: dict = Depends(verify_api_key)):
    try:
        from app.database import get_graph_nodes, get_graph_relationships
        company_id = str(company["_id"])
        
        nodes = get_graph_nodes(company_id)
        relationships = get_graph_relationships(company_id)

        # Format for frontend
        formatted_nodes = []
        for node in nodes:
            node_type = node.get("type", "unknown").lower()
            color_map = {
                "person": "#a78bfa",
                "client": "#ef4444",
                "incident": "#f97316",
                "project": "#3b82f6"
            }
            # Override client color based on health
            if node_type == "client":
                health = node.get("properties", {}).get("health", "healthy")
                color_map["client"] = (
                    "#ef4444" if health == "at_risk" else
                    "#f59e0b" if health == "onboarding" else
                    "#10b981"
                )

            formatted_nodes.append({
                "id": node["name"],
                "group": node_type,
                "color": color_map.get(node_type, "#8b8fa8"),
                "val": 3 if node_type == "person" else 4 if node_type == "client" else 2
            })

        formatted_links = [
            {
                "source": rel["from"],
                "target": rel["to"],
                "label": rel["relationship"]
            }
            for rel in relationships
        ]

        return {
            "success": True,
            "nodes": formatted_nodes,
            "links": formatted_links
        }
    except Exception as e:
        return {"success": False, "nodes": [], "links": [], "message": str(e)}


@app.get("/api/timeline")
async def get_timeline(company: dict = Depends(verify_api_key)):
    try:
        company_id = str(company["_id"])
        
        # Pull from audit logs, sync history, alerts, pending actions
        from app.database import db
        from bson import ObjectId
        
        events = []
        
        # Sync events
        syncs = list(db.sync_history.find(
            {"company_id": company_id}
        ).sort("synced_at", -1).limit(20))
        
        for s in syncs:
            events.append({
                "id": str(s["_id"]),
                "type": "sync",
                "title": f"Synced {s['source'].title()}",
                "description": f"{s['items_synced']} items indexed, {s['chunks_indexed']} chunks",
                "timestamp": s["synced_at"].isoformat(),
                "color": "#7c3aed"
            })
        
        # Alert events
        alerts = list(db.alerts.find(
            {"company_id": company_id}
        ).sort("created_at", -1).limit(20))
        
        for a in alerts:
            events.append({
                "id": str(a["_id"]),
                "type": "alert",
                "title": a["title"],
                "description": a["description"],
                "timestamp": a["created_at"].isoformat(),
                "color": "#ef4444" if a["severity"] == "critical" else "#f59e0b",
                "severity": a["severity"]
            })
        
        # Feedback events
        feedback = list(db.feedback.find(
            {"company_id": company_id}
        ).sort("created_at", -1).limit(10))
        
        for f in feedback:
            events.append({
                "id": str(f["_id"]),
                "type": "feedback",
                "title": f"{'Correction' if f['feedback_type'] == 'bad' else 'Confirmed answer'}",
                "description": f"Q: {f['question'][:80]}...",
                "timestamp": f["created_at"].isoformat(),
                "color": "#10b981"
            })

        # Approved/rejected actions
        actions = list(db.pending_actions.find(
            {"company_id": company_id, "status": {"$in": ["approved", "rejected"]}}
        ).sort("resolved_at", -1).limit(10))

        for a in actions:
            events.append({
                "id": str(a["_id"]),
                "type": "action",
                "title": f"Agent action {a['status']}: {a['action_type']}",
                "description": str(a.get("details", {}))[:100],
                "timestamp": a.get("resolved_at", a["created_at"]).isoformat(),
                "color": "#10b981" if a["status"] == "approved" else "#4a5068"
            })

        # Sort all events by timestamp descending
        events.sort(key=lambda x: x["timestamp"], reverse=True)

        return {"success": True, "events": events}
    except Exception as e:
        return {"success": False, "events": [], "message": str(e)}


@app.post("/api/graph/extract")
async def extract_graph(company: dict = Depends(verify_api_key)):
    try:
        from app.entity_extractor import extract_entities_from_chunks, get_chunks_from_pinecone
        company_id = str(company["_id"])
        namespace = company.get("pinecone_namespace", "default")

        # Clear existing graph for this company first
        from app.database import db
        db.graph_nodes.delete_many({"company_id": company_id})
        db.graph_relationships.delete_many({"company_id": company_id})

        # Topics to search for entity extraction
        topics = [
            "team members employees roles responsibilities",
            "clients customers accounts SLA contracts",
            "incidents bugs outages failures errors",
            "projects features roadmap initiatives",
            "decisions meetings action items owners"
        ]

        # Fetch relevant chunks
        chunks = get_chunks_from_pinecone(
            index=index,
            namespace=namespace,
            embeddings=embeddings,
            topics=topics
        )

        if not chunks:
            return {
                "success": False,
                "message": "No chunks found. Sync your tools first."
            }

        # Extract entities
        result = extract_entities_from_chunks(
            chunks=chunks,
            llm=llm,
            company_id=company_id
        )

        return {
            "success": True,
            "message": f"Extracted {result['nodes']} entities and {result['relationships']} relationships from your company data.",
            "nodes": result["nodes"],
            "relationships": result["relationships"]
        }

    except Exception as e:
        return {"success": False, "message": str(e)}


@app.get("/api/scheduler/status")
async def scheduler_status(company: dict = Depends(verify_api_key)):
    try:
        from app.scheduler import scheduler
        job = scheduler.get_job("auto_sync")
        if job and job.next_run_time:
            next_run = job.next_run_time.isoformat()
        else:
            next_run = None
        return {
            "success": True,
            "running": scheduler.running,
            "next_sync": next_run
        }
    except Exception as e:
        return {"success": False, "running": False, "next_sync": None}

@app.post("/api/scheduler/trigger")
async def trigger_sync(company: dict = Depends(verify_api_key)):
    try:
        from app.scheduler import sync_all_companies
        await sync_all_companies(index, embeddings, llm)
        return {"success": True, "message": "Manual sync triggered successfully."}
    except Exception as e:
        return {"success": False, "message": str(e)}


@app.get("/api/dashboard")
async def get_dashboard(company: dict = Depends(verify_api_key)):
    try:
        from app.database import db
        company_id = str(company["_id"])

        # Active alerts
        active_alerts = list(db.alerts.find({
            "company_id": company_id,
            "resolved": False
        }))
        critical_alerts = [a for a in active_alerts if a.get("severity") == "critical"]

        # Sync history
        syncs = list(db.sync_history.find(
            {"company_id": company_id}
        ).sort("synced_at", -1))

        total_chunks = sum(s.get("chunks_indexed", 0) for s in syncs)
        last_sync = syncs[0]["synced_at"].isoformat() if syncs else None

        # Unique sources synced
        sources_synced = list(set([s["source"] for s in syncs]))

        # Feedback stats
        total_corrections = db.feedback.count_documents({
            "company_id": company_id,
            "feedback_type": "bad"
        })
        total_good = db.feedback.count_documents({
            "company_id": company_id,
            "feedback_type": "good"
        })

        # Pending actions
        pending_actions = db.pending_actions.count_documents({
            "company_id": company_id,
            "status": "pending"
        })

        # Graph stats
        total_nodes = db.graph_nodes.count_documents({"company_id": company_id})
        total_relationships = db.graph_relationships.count_documents({"company_id": company_id})

        # Knowledge growth (chunks per sync over time)
        knowledge_growth = [
            {
                "date": s["synced_at"].strftime("%d %b"),
                "chunks": s.get("chunks_indexed", 0),
                "source": s.get("source", "unknown")
            }
            for s in reversed(syncs[-10:])
        ]

        # Client health from graph
        clients = list(db.graph_nodes.find({
            "company_id": company_id,
            "type": "Client"
        }))
        client_health = [
            {
                "name": c["name"],
                "health": c.get("properties", {}).get("health", "unknown")
            }
            for c in clients
        ]

        # Action items from graph relationships
        people = list(db.graph_nodes.find({
            "company_id": company_id,
            "type": "Person"
        }))
        
        # Compute health score (0-100)
        health_score = 100
        health_score -= len(critical_alerts) * 15
        health_score -= len([c for c in client_health if c["health"] == "at_risk"]) * 10
        health_score -= pending_actions * 5
        health_score -= total_corrections * 2
        health_score = max(0, min(100, health_score))

        return {
            "success": True,
            "health_score": health_score,
            "alerts": {
                "total": len(active_alerts),
                "critical": len(critical_alerts)
            },
            "knowledge": {
                "total_chunks": total_chunks,
                "sources_count": len(sources_synced),
                "sources": sources_synced,
                "last_sync": last_sync,
                "growth": knowledge_growth
            },
            "graph": {
                "nodes": total_nodes,
                "relationships": total_relationships,
                "clients": client_health
            },
            "feedback": {
                "corrections": total_corrections,
                "confirmed": total_good
            },
            "pending_actions": pending_actions,
            "people_count": len(people)
        }

    except Exception as e:
        return {"success": False, "message": str(e)}


@app.post("/api/webhook/slack")
async def slack_webhook(request: Request):
    print("=" * 50)
    print("WEBHOOK HIT! - Slack event received")
    print("=" * 50)
    try:
        body = await request.json()
        print(f"DEBUG webhook: payload type = {type(body)}")
        print(f"DEBUG webhook: payload = {body}")
        
        # Slack URL verification challenge
        if body.get("type") == "url_verification":
            print("DEBUG webhook: URL verification challenge")
            return {"challenge": body.get("challenge")}

        # When processing a message:
        if "event" in body:
            print(f"DEBUG webhook: event type = {body['event'].get('type')}")
            print(f"DEBUG webhook: channel = {body['event'].get('channel')}")
            print(f"DEBUG webhook: text = {body['event'].get('text')}")
        
        # Handle message events
        if body.get("type") == "event_callback":
            event = body.get("event", {})
            
            if event.get("type") == "message" and (not event.get("subtype") or event.get("subtype") == "bot_message"):
                text = event.get("text", "").strip()
                channel = event.get("channel", "unknown")
                
                if not text or len(text) < 10:
                    return {"ok": True}
                
                # Get channel name
                channel_name = f"channel_{channel}"
                
                # Find which company owns this Slack token
                from app.database import db
                companies = list(db.companies.find({
                    "tokens.slack_token": {"$exists": True},
                    "active": True
                }))
                
                for company in companies:
                    try:
                        company_id = str(company["_id"])
                        namespace = company.get("pinecone_namespace", "default")
                        slack_token = company.get("tokens", {}).get("slack_token")
                        
                        if slack_token:
                            # Get real channel name
                            from slack_sdk import WebClient
                            client = WebClient(token=slack_token)
                            try:
                                ch_info = client.conversations_info(channel=channel)
                                channel_name = ch_info["channel"]["name"]
                            except:
                                pass
                        
                        # Chunk and index immediately
                        chunk_text = f"Slack channel: #{channel_name}\n{text}"
                        
                        from app.pii_detector import scan_chunks
                        from app.encryption import encrypt_chunks
                        
                        chunks = [{"text": chunk_text, "source": f"Slack: #{channel_name}"}]
                        chunks, _ = scan_chunks(chunks)
                        chunks = encrypt_chunks(chunks, company_id)
                        
                        vector = embeddings.embed_documents([chunks[0]["text"]])[0]
                        
                        import time
                        from datetime import datetime
                        print(f"DEBUG webhook upsert: namespace='{namespace}' text='{text[:50]}' realtime=True")
                        index.upsert(
                            vectors=[{
                                "id": f"slack_rt_{channel}_{int(time.time())}",
                                "values": vector,
                                "metadata": {
                                    "text": chunks[0]["text"],
                                    "source": chunks[0]["source"],
                                    "encrypted": True,
                                    "timestamp": datetime.utcnow().isoformat(),
                                    "realtime": True
                                }
                            }],
                            namespace=namespace
                        )
                        print(f"[Webhook] Indexed real-time Slack message from #{channel_name}")
                        
                    except Exception as e:
                        print(f"[Webhook] Failed to index for company {company_id}: {e}")
        
        return {"ok": True}
        
    except Exception as e:
        print(f"[Webhook] Error: {e}")
        return {"ok": True}


def retrieve_context(question: str, namespace: str, company_id: str, top_k: int = 5) -> list:
    try:
        from app.rag import rag_enabled, index, embeddings, init_rag
        from app.encryption import decrypt_chunks
        
        if not rag_enabled:
            init_rag()
            
        if not index or not embeddings:
            return []
            
        query_vector = embeddings.embed_query(question)
        search_response = index.query(
            vector=query_vector,
            top_k=top_k,
            include_metadata=True,
            namespace=namespace
        )
        
        decrypted = decrypt_chunks(search_response.matches, company_id)
        return decrypted
    except Exception as e:
        print(f"Error retrieving context: {e}")
        return []


@app.post("/api/chat/with-image")
async def chat_with_image(
    file: UploadFile = File(...),
    question: str = Form(""),
    company: dict = Depends(verify_api_key)
):
    """Chat with an uploaded image."""
    
    try:
        # Read image
        image_bytes = await file.read()
        
        # Analyze image
        from app.multimodal import describe_image, format_for_search
        
        image_description = describe_image(image_bytes)
        image_text = format_for_search(image_description)
        
        # If user asked a question, use it. Otherwise, describe the image
        if not question.strip():
            question = f"Describe this image and extract key information"
        
        # Get context from knowledge base (if there's a question)
        context_chunks = []
        if question:
            company_id = str(company["_id"])
            namespace = company.get("pinecone_namespace", "")
            context_chunks = retrieve_context(question, namespace, company_id, top_k=5)
        
        # Combine context
        context = "\n\n".join([c["text"] for c in context_chunks])
        
        # Generate answer
        from app.gemini_http import HTTPChatGoogleGenerativeAI
        model = HTTPChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            google_api_key=config.GEMINI_API_KEY,
            temperature=0.2,
            streaming=False
        )
        
        prompt = f"""
        User uploaded an image and asked: "{question}"
        
        Image analysis: {image_text}
        
        Additional context from knowledge base: {context}
        
        Answer the user's question based on the image and context.
        If the image is a chart, include the actual data points in your answer.
        """
        
        response = model.invoke(prompt)
        answer = response.content
        
        return {
            "success": True,
            "answer": answer,
            "image_description": image_description,
            "sources": [c.get("source", "") for c in context_chunks]
        }
    
    except Exception as e:
        print(f"[Image Chat] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/health")
async def health_check():
    return {"status": "healthy"}