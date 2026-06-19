# Simulated knowledge graph
# Replace with Neo4j when deploying on server with Python 3.11

from app.database import save_graph_node, save_graph_relationship, get_graph_nodes as db_get_graph_nodes, get_graph_relationships

GRAPH = {
    "people": [
        {"name": "Rahul Sharma", "role": "CEO"},
        {"name": "Priya Nair", "role": "Head of Operations"},
        {"name": "Dev Mehta", "role": "Lead Engineer"},
        {"name": "Ananya Iyer", "role": "Customer Success"},
        {"name": "Karan Joshi", "role": "BD Manager"},
        {"name": "Vikram Rao", "role": "Finance"},
    ],
    "clients": [
        {"name": "Flipkart", "health": "at_risk", "value": "8.5L/month"},
        {"name": "Myntra", "health": "healthy", "value": "4.2L/month"},
        {"name": "Meesho", "health": "onboarding", "value": "TBD"},
    ],
    "incidents": [
        {
            "name": "Flipkart Zone 3 Incident",
            "date": "2024-12-18",
            "status": "resolved",
            "fixed_by": "Dev Mehta",
            "managed_by": "Priya Nair",
            "affected_client": "Flipkart"
        },
    ],
    "relationships": [
        {"from": "Ananya Iyer", "to": "Flipkart", "type": "OWNS_ACCOUNT"},
        {"from": "Ananya Iyer", "to": "Myntra", "type": "OWNS_ACCOUNT"},
        {"from": "Dev Mehta", "to": "Flipkart Zone 3 Incident", "type": "FIXED"},
        {"from": "Priya Nair", "to": "Flipkart Zone 3 Incident", "type": "MANAGED"},
        {"from": "Rahul Sharma", "to": "Flipkart Zone 3 Incident", "type": "DECIDED_COMPENSATION"},
        {"from": "Karan Joshi", "to": "Meesho", "type": "CLOSED_DEAL"},
    ]
}

graph_enabled = True

def get_all_nodes(company_id: str = "demo"):
    """
    Returns graph nodes from MongoDB if available, else falls back to in-memory.
    """
    try:
        db_nodes = db_get_graph_nodes(company_id)
        if db_nodes:
            return [
                {
                    "type": [node["type"]],
                    "name": node["name"],
                    "props": node["properties"]
                }
                for node in db_nodes
            ]
    except Exception as e:
        print(f"Falling back to in-memory graph: {e}")

    # Fallback to in-memory
    nodes = []
    for person in GRAPH["people"]:
        nodes.append({"type": ["Person"], "name": person["name"], "props": person})
    for client in GRAPH["clients"]:
        nodes.append({"type": ["Client"], "name": client["name"], "props": client})
    for incident in GRAPH["incidents"]:
        nodes.append({"type": ["Incident"], "name": incident["name"], "props": incident})
    return nodes

def get_person_context(name: str):
    results = []
    for rel in GRAPH["relationships"]:
        if rel["from"] == name:
            results.append({
                "relationship": rel["type"],
                "related": rel["to"],
            })
    return results

def get_graph_summary():
    return {
        "people": len(GRAPH["people"]),
        "clients": len(GRAPH["clients"]),
        "incidents": len(GRAPH["incidents"]),
        "relationships": len(GRAPH["relationships"])
    }

def query_graph(question: str):
    q = question.lower()
    results = []

    if "who" in q and ("fix" in q or "resolve" in q or "handle" in q):
        for inc in GRAPH["incidents"]:
            results.append(
                f"{inc['name']} was fixed by {inc['fixed_by']} "
                f"and managed by {inc['managed_by']}"
            )

    if "flipkart" in q and ("who" in q or "owner" in q or "account" in q):
        for rel in GRAPH["relationships"]:
            if rel["to"] == "Flipkart" and rel["type"] == "OWNS_ACCOUNT":
                results.append(f"{rel['from']} owns the Flipkart account")

    if "risk" in q or "health" in q:
        for client in GRAPH["clients"]:
            results.append(
                f"{client['name']} is {client['health']}"
            )

    if "expert" in q or "knows" in q or "best person" in q:
        for rel in GRAPH["relationships"]:
            results.append(
                f"{rel['from']} has relationship {rel['type']} with {rel['to']}"
            )

    return results if results else ["No specific graph context found."]

def seed_swiftmove_graph(company_id: str = "demo"):
    """
    Seeds the knowledge graph with SwiftMove Logistics data.
    Saves to both in-memory dict and MongoDB for persistence.
    """
    try:
        for person in GRAPH["people"]:
            save_graph_node(company_id, "Person", person["name"], person)

        for client in GRAPH["clients"]:
            save_graph_node(company_id, "Client", client["name"], client)

        for incident in GRAPH["incidents"]:
            save_graph_node(company_id, "Incident", incident["name"], incident)

        for rel in GRAPH["relationships"]:
            save_graph_relationship(company_id, rel["from"], rel["to"], rel["type"])

        print("INFO: Knowledge graph seeded and persisted to MongoDB.")
        return True
    except Exception as e:
        print(f"ERROR seeding graph: {e}")
        return False

def init_graph():
    print("INFO: Simulated knowledge graph initialized.")
    return True
