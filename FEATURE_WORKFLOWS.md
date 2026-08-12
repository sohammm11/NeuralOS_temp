# 🧠 NeuralOS Feature Workflows - Teammate Guide

Welcome to NeuralOS! This guide is designed to help you quickly understand every feature and workflow in the project in simple, easy-to-understand language. We've broken down every core feature so you know exactly how data flows from A to Z.

---

## 🚀 1. The Core Idea
**NeuralOS** is like a "Company Brain". It connects to our scattered tools (Notion, Slack, Google Drive, Gmail), reads all the data securely, and lets us chat with it to get answers instantly. It can also detect risks automatically and help us take action (like creating a ticket) right from the chat.

---

## 🔄 2. Data Ingestion & Security Workflow
Before we can chat with our data, it has to be imported (ingested) securely. This is how the background ingestion pipeline works:

1. **Auto-Sync Scheduler**: A background job (using `apscheduler` in FastAPI) wakes up every hour and pulls new data from our connected integrations (Notion, Slack, Drive, Gmail).
2. **PII Detection**: The raw text chunks are scanned for sensitive info. Things like Email addresses, Phone numbers, Aadhaar cards, PAN cards, and Credit Cards are automatically replaced with `[TYPE REDACTED]` tokens to prevent data leaks.
3. **Encryption at Rest**: We don't store plain text in the cloud vector database. Instead, each company has a unique encryption key (derived using PBKDF2). The redacted chunks are encrypted using this key (Fernet encryption).
4. **Vector Storage**: Finally, the encrypted chunks are sent to **Pinecone** (our Vector Database) along with their AI-generated embeddings (via Gemini) for fast searching later.

---

## 🔍 3. Hybrid RAG Search Workflow
When a user asks a question in the NeuralOS chat, here's what happens behind the scenes:

1. **Query Rewriting**: The user's question and recent chat history are sent to Gemini to be rewritten into an optimized, keyword-rich search query.
2. **Parallel Hybrid Search**:
   - **Dense Search (Semantic)**: The query is converted into an embedding and sent to Pinecone to find matches based on *meaning*.
   - **Sparse Search (BM25)**: A keyword-based search is performed to find exact matches (like specific error codes or names).
3. **Reciprocal Rank Fusion (RRF)**: The results from both the Dense and Sparse searches are mathematically fused together to give us the best of both worlds.
4. **Local Decryption**: The matching encrypted chunks retrieved from Pinecone are decrypted locally in our backend memory.
5. **Cohere Reranking**: The top results are sent to Cohere's reranker model to re-evaluate and sort them by true relevance.
6. **Quality Gate Check**: If the best match score is too low (below 55%), NeuralOS will warn the user instead of guessing, preventing "hallucinations".
7. **Streaming Answer**: The final relevant context is passed to Gemini 3.5 Flash, which streams the answer back to the user's dashboard in real-time using Server-Sent Events (SSE).

---

## ⚡ 4. Proactive Agents & Action Workflows
NeuralOS doesn't just answer questions; it can take actions on our behalf safely.

1. **Intent Detection**: While analyzing the chat, NeuralOS detects if the user wants to perform a task (e.g., "Remind Priya to fix the API" or "Notify ops on Slack").
2. **Pending Actions**: Instead of executing the action immediately (which is risky), it creates a pending "Task" or "Slack Notification" record in MongoDB.
3. **Human-in-the-Loop Gateway**: The user sees this pending action in the dashboard. They must manually review the details (title, assignee, message) and click **Approve**.
4. **Execution**: Once approved, the backend scheduler fires the actual API call to Notion or Slack.

---

## ⚠️ 5. Anomaly & Risk Alerts Workflow
NeuralOS acts as an early warning system for the business.

1. **Periodic Semantic Checks**: A background job continuously searches the newly indexed chunks for specific "risk phrases" (e.g., "SLA breach", "complaint", "server timeout").
2. **Risk Scoring**: If the semantic search finds high-confidence matches for these risks in client emails or internal Slack chats, it flags them.
3. **Alert Dashboard**: These critical anomalies are surfaced to stakeholders on the dashboard, ensuring that client escalations or system failures are never missed.

---

## 🕸️ 6. Dynamic Knowledge Graph Workflow
To help visualize relationships between data points:

1. **Entity Extraction**: As data is processed, NeuralOS extracts key entities like People, Clients, Projects, and Incidents.
2. **Edge Creation**: It maps relationships between these entities (e.g., "Ananya Iyer -> OWNS_ACCOUNT -> Flipkart" or "Dev Mehta -> FIXED -> Incident").
3. **Frontend Visualization**: The Next.js frontend uses a dynamic D3 Force layout (`react-force-graph-2d`) to render an interactive map of these relationships. Nodes even change color (e.g., turning red) if their health metrics indicate they are "at risk".

---

## 🛠️ Summary of Tech Stack
- **Frontend**: Next.js 16 (React), D3 Force Layout
- **Backend**: FastAPI (Python), APScheduler (Cron Jobs)
- **Databases**: MongoDB (Logs, Sessions, Graphs), Pinecone (Vector Storage)
- **AI Models**: Gemini (Embeddings, Chat, Query Rewriting), Cohere (Reranking)
- **Search Algorithims**: BM25 (Sparse keyword search), Reciprocal Rank Fusion (Scoring)

This combination ensures NeuralOS is fast, secure, accurate, and actionable.
