from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from datetime import datetime

scheduler = AsyncIOScheduler()

async def auto_sync_company(company: dict, index, embeddings, llm):
    """
    Auto-syncs all connected sources for a company.
    """
    from app.database import db, log_sync
    from app.anomaly import analyze_company

    company_id = str(company["_id"])
    namespace = company.get("pinecone_namespace", "default")
    tokens = company.get("tokens", {})

    print(f"[Scheduler] Auto-syncing {company.get('name', company_id)}...")

    # Sync Notion if token exists
    notion_token = tokens.get("notion_token")
    if notion_token:
        try:
            from app.notion_connector import get_notion_pages, chunk_and_prepare
            from langchain_google_genai import GoogleGenerativeAIEmbeddings
            import app.config as config

            pages = get_notion_pages(notion_token)
            if pages:
                chunks = chunk_and_prepare(pages)
                vectors_data = []
                texts = [c["text"] for c in chunks]
                vectors = embeddings.embed_documents(texts)
                for j, (chunk, vector) in enumerate(zip(chunks, vectors)):
                    vectors_data.append({
                        "id": f"notion_auto_{company_id}_{j}",
                        "values": vector,
                        "metadata": {"text": chunk["text"], "source": chunk["source"]}
                    })
                index.upsert(vectors=vectors_data, namespace=namespace)
                log_sync(company_id, "notion_auto", len(pages), len(chunks))
                print(f"[Scheduler] Notion synced: {len(pages)} pages")
        except Exception as e:
            print(f"[Scheduler] Notion sync failed: {e}")

    # Sync Slack if token exists
    slack_token = tokens.get("slack_token")
    if slack_token:
        try:
            from app.slack_connector import get_slack_messages, chunk_slack_messages
            channels = get_slack_messages(slack_token)
            if channels:
                chunks = chunk_slack_messages(channels)
                texts = [c["text"] for c in chunks]
                vectors = embeddings.embed_documents(texts)
                vectors_data = []
                for j, (chunk, vector) in enumerate(zip(chunks, vectors)):
                    vectors_data.append({
                        "id": f"slack_auto_{company_id}_{j}",
                        "values": vector,
                        "metadata": {"text": chunk["text"], "source": chunk["source"]}
                    })
                index.upsert(vectors=vectors_data, namespace=namespace)
                log_sync(company_id, "slack_auto", len(channels), len(chunks))
                print(f"[Scheduler] Slack synced: {len(channels)} channels")
        except Exception as e:
            print(f"[Scheduler] Slack sync failed: {e}")

    # Run anomaly scan after sync
    try:
        analyze_company(company_id, index, embeddings, namespace)
        print(f"[Scheduler] Anomaly scan complete")
    except Exception as e:
        print(f"[Scheduler] Anomaly scan failed: {e}")


async def sync_all_companies(index, embeddings, llm):
    """
    Runs auto-sync for all active companies that have stored tokens.
    """
    from app.database import db
    companies = list(db.companies.find({"active": True}))
    for company in companies:
        try:
            await auto_sync_company(company, index, embeddings, llm)
        except Exception as e:
            print(f"[Scheduler] Failed for company {company.get('name')}: {e}")


def start_scheduler(index, embeddings, llm):
    scheduler.add_job(
        sync_all_companies,
        trigger=IntervalTrigger(hours=1),
        args=[index, embeddings, llm],
        id="auto_sync",
        replace_existing=True,
        next_run_time=None  # Don't run immediately on startup
    )
    scheduler.start()
    print("INFO: Auto-sync scheduler started (runs every hour)")


def stop_scheduler():
    scheduler.shutdown()