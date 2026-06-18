from pymongo import MongoClient, ASCENDING
from datetime import datetime
import hashlib
import secrets
import app.config as config

client = None
db = None

def init_db():
    global client, db
    try:
        client = MongoClient(config.MONGODB_URI)
        db = client.neuralos
        
        # Test connection
        client.admin.command('ping')
        print("INFO: MongoDB connected successfully.")
        
        # Create indexes
        db.companies.create_index([("api_key_hash", ASCENDING)], unique=True)
        db.feedback.create_index([("company_id", ASCENDING)])
        db.audit_logs.create_index([("company_id", ASCENDING)])
        db.sync_history.create_index([("company_id", ASCENDING)])
        
        return True
    except Exception as e:
        print(f"WARNING: MongoDB connection failed: {e}")
        return False

# ─── Companies ───────────────────────────────────────────

def create_company(company_name: str):
    """Creates a new company and returns their API key."""
    api_key = f"nros_{secrets.token_urlsafe(24)}"
    api_key_hash = hashlib.sha256(api_key.encode()).hexdigest()
    
    company = {
        "name": company_name,
        "api_key_hash": api_key_hash,
        "pinecone_namespace": company_name.lower().replace(" ", "_"),
        "created_at": datetime.utcnow(),
        "active": True,
        "plan": "free"
    }
    
    result = db.companies.insert_one(company)
    return {
        "company_id": str(result.inserted_id),
        "api_key": api_key,
        "message": f"Company '{company_name}' created successfully."
    }

def get_company_by_api_key(api_key: str):
    """Finds company by API key."""
    api_key_hash = hashlib.sha256(api_key.encode()).hexdigest()
    return db.companies.find_one({"api_key_hash": api_key_hash, "active": True})

def get_company_namespace(api_key: str):
    """Returns Pinecone namespace for a company."""
    company = get_company_by_api_key(api_key)
    if company:
        return company.get("pinecone_namespace", "default")
    return "default"

# ─── Feedback ────────────────────────────────────────────

def save_feedback(company_id: str, question: str, 
                  answer: str, feedback_type: str, 
                  correction: str = None):
    feedback = {
        "company_id": company_id,
        "question": question,
        "answer": answer,
        "feedback_type": feedback_type,
        "correction": correction,
        "created_at": datetime.utcnow()
    }
    db.feedback.insert_one(feedback)

def get_corrections(company_id: str, question: str):
    """Gets relevant corrections for a question."""
    corrections = list(db.feedback.find({
        "company_id": company_id,
        "feedback_type": "bad",
        "correction": {"$exists": True, "$ne": None}
    }).sort("created_at", -1).limit(20))
    
    question_words = set(question.lower().split())
    relevant = []
    
    for c in corrections:
        stored_words = set(c["question"].lower().split())
        overlap = question_words & stored_words
        if len(overlap) >= 2:
            relevant.append(c)
    
    return relevant[:5]

def get_feedback_stats(company_id: str):
    return {
        "total_corrections": db.feedback.count_documents({
            "company_id": company_id,
            "feedback_type": "bad"
        }),
        "total_good_answers": db.feedback.count_documents({
            "company_id": company_id,
            "feedback_type": "good"
        })
    }

# ─── Audit Logs ──────────────────────────────────────────

def log_action(company_id: str, action: str, details: str):
    db.audit_logs.insert_one({
        "company_id": company_id,
        "action": action,
        "details": details,
        "created_at": datetime.utcnow()
    })

def get_audit_logs(company_id: str, limit: int = 50):
    logs = list(db.audit_logs.find(
        {"company_id": company_id},
        {"_id": 0}
    ).sort("created_at", -1).limit(limit))
    return logs

# ─── Sync History ────────────────────────────────────────

def log_sync(company_id: str, source: str, 
             items_synced: int, chunks_indexed: int):
    db.sync_history.insert_one({
        "company_id": company_id,
        "source": source,
        "items_synced": items_synced,
        "chunks_indexed": chunks_indexed,
        "synced_at": datetime.utcnow()
    })

def get_sync_history(company_id: str):
    return list(db.sync_history.find(
        {"company_id": company_id},
        {"_id": 0}
    ).sort("synced_at", -1).limit(10))

# ─── Knowledge Graph ─────────────────────────────────────

def save_graph_node(company_id: str, node_type: str, 
                    name: str, properties: dict):
    db.graph_nodes.update_one(
        {"company_id": company_id, "name": name, "type": node_type},
        {"$set": {
            "company_id": company_id,
            "type": node_type,
            "name": name,
            "properties": properties,
            "updated_at": datetime.utcnow()
        }},
        upsert=True
    )

def save_graph_relationship(company_id: str, from_name: str,
                            to_name: str, relationship: str):
    db.graph_relationships.update_one(
        {
            "company_id": company_id,
            "from": from_name,
            "to": to_name,
            "relationship": relationship
        },
        {"$set": {
            "company_id": company_id,
            "from": from_name,
            "to": to_name,
            "relationship": relationship,
            "updated_at": datetime.utcnow()
        }},
        upsert=True
    )

def get_graph_nodes(company_id: str):
    return list(db.graph_nodes.find(
        {"company_id": company_id},
        {"_id": 0}
    ))

def get_graph_relationships(company_id: str):
    return list(db.graph_relationships.find(
        {"company_id": company_id},
        {"_id": 0}
    ))

db_enabled = init_db()