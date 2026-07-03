from datetime import datetime, timedelta
from app.database import create_alert, db

def get_message_volume(company_id: str, source: str, days: int):
    """Count chunks indexed in the last N days for a source."""
    cutoff = datetime.utcnow() - timedelta(days=days)
    return db.sync_history.count_documents({
        "company_id": company_id,
        "source": source,
        "synced_at": {"$gte": cutoff}
    })

def analyze_company(company_id: str, index, embeddings, namespace: str = "default"):
    """
    Runs anomaly checks for a company and creates alerts.
    Returns list of new alerts found.
    """
    print(f"ANOMALY: scanning namespace={namespace} company={company_id}")
    alerts_found = []

    # ── Check 1: Flipkart/client risk keywords spiking ──
    try:
        risk_query = embeddings.embed_query(
            "SLA breach escalation complaint angry client threatening"
        )
        results = index.query(
            vector=risk_query,
            top_k=10,
            include_metadata=True,
            namespace=namespace
        )

        print(f"DEBUG anomaly scores: {[(m.score, m.metadata.get('source','?')) for m in results.matches]}")

        high_risk_chunks = []
        for match in results.matches:
            if match.score > 0.60:
                text = match.metadata.get("text", "")
                source = match.metadata.get("source", "")
                high_risk_chunks.append({"text": text, "source": source})

        if len(high_risk_chunks) >= 1:
            sources = list(set([c["source"] for c in high_risk_chunks]))
            alert_id = create_alert(
                company_id=company_id,
                alert_type="client_risk",
                title="High client risk signals detected",
                description=(
                    f"Found {len(high_risk_chunks)} high-similarity matches "
                    f"for risk keywords across {', '.join(sources[:3])}. "
                    f"Recent content suggests escalation or SLA issues may be active."
                ),
                severity="critical"
            )
            alerts_found.append(alert_id)

    except Exception as e:
        print(f"Anomaly check 1 failed: {e}")

    # ── Check 2: Overdue action items ──
    try:
        action_query = embeddings.embed_query(
            "action item due deadline overdue pending incomplete"
        )
        results = index.query(
            vector=action_query,
            top_k=5,
            include_metadata=True,
            namespace=namespace
        )

        action_chunks = [
            m for m in results.matches if m.score > 0.60
        ]

        if len(action_chunks) >= 1:
            alert_id = create_alert(
                company_id=company_id,
                alert_type="overdue_actions",
                title="Overdue action items detected",
                description=(
                    f"Found {len(action_chunks)} chunks referencing pending or "
                    f"overdue tasks. Review the Insights tab for details."
                ),
                severity="warning"
            )
            alerts_found.append(alert_id)

    except Exception as e:
        print(f"Anomaly check 2 failed: {e}")

    # ── Check 3: Technical risk keywords ──
    try:
        tech_query = embeddings.embed_query(
            "bug error crash timeout failure outage system down"
        )
        results = index.query(
            vector=tech_query,
            top_k=8,
            include_metadata=True,
            namespace=namespace
        )

        tech_chunks = [
            m for m in results.matches if m.score > 0.60
        ]

        if len(tech_chunks) >= 1:
            alert_id = create_alert(
                company_id=company_id,
                alert_type="tech_risk",
                title="Technical risk signals detected",
                description=(
                    f"Found {len(tech_chunks)} high-similarity matches for "
                    f"technical failure keywords. Review architecture and "
                    f"incident history for potential issues."
                ),
                severity="warning"
            )
            alerts_found.append(alert_id)

    except Exception as e:
        print(f"Anomaly check 3 failed: {e}")

    return alerts_found