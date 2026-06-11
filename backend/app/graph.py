# Simulated knowledge graph
# Replace with Neo4j when deploying on server with Python 3.11

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

def get_all_nodes():
    nodes = []
    for person in GRAPH["people"]:
        nodes.append({
            "type": ["Person"],
            "name": person["name"],
            "props": person
        })
    for client in GRAPH["clients"]:
        nodes.append({
            "type": ["Client"],
            "name": client["name"],
            "props": client
        })
    for incident in GRAPH["incidents"]:
        nodes.append({
            "type": ["Incident"],
            "name": incident["name"],
            "props": incident
        })
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

def seed_swiftmove_graph():
    print("INFO: Using simulated knowledge graph.")
    return True

def init_graph():
    print("INFO: Simulated knowledge graph initialized.")
    return True
