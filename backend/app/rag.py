import os
from langchain_google_genai import GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI
from pinecone import Pinecone
import app.config as config
from app.graph import query_graph, graph_enabled
from app.feedback import get_relevant_corrections

# Global variables initialized to None
embeddings = None
pc_client = None
index = None
llm = None

def init_rag():
    global embeddings, pc_client, index, llm
    
    # Check if keys are present
    if not config.GEMINI_API_KEY or not config.PINECONE_API_KEY:
        print("RAG Configuration: API keys missing. Operating in fallback mock mode.")
        return False
        
    try:
        # 1. Initialize Gemini Embeddings
        embeddings = GoogleGenerativeAIEmbeddings(
            model="models/gemini-embedding-001",
            google_api_key=config.GEMINI_API_KEY,
            output_dimensionality=768
        )
        
        # 2. Initialize Pinecone client & Vector store index
        pc_client = Pinecone(api_key=config.PINECONE_API_KEY)
        
        # Check if the index exists in pinecone
        active_indexes = [idx.name for idx in pc_client.list_indexes()]
        if config.PINECONE_INDEX_NAME not in active_indexes:
            print(f"WARNING: Pinecone index '{config.PINECONE_INDEX_NAME}' was not found in active indexes: {active_indexes}.")
            print("Please create the index in your Pinecone console with 768 dimensions (cosine metric) or run the ingestion script to initialize.")
            return False
            
        index = pc_client.Index(config.PINECONE_INDEX_NAME)
        
        # 3. Initialize Gemini Chat LLM
        llm = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            google_api_key=config.GEMINI_API_KEY,
            temperature=0.2,
            streaming=True
        )
        return True
    except Exception as e:
        print(f"Error initializing RAG system: {e}")
        return False

# Try initializing on module load
rag_enabled = init_rag()

def query_rag(question: str, history: list = [], namespace: str = "default"):
    """
    Search Pinecone vector store, construct the prompt, query Gemini, and return the answer + sources.
    If RAG setup is incomplete, fallback to a clean system response.
    """
    global rag_enabled, index, llm, embeddings
    
    # Double check initialization in case keys were updated later
    if not rag_enabled:
        rag_enabled = init_rag()
        
    if not rag_enabled or not index or not llm or not embeddings:
        # Return fallback mock responses for demonstration (so the system works out of the box)
        return get_mock_response(question)
        
    try:
        # 1. Embed the user question
        query_vector = embeddings.embed_query(question)
        
        # 2. Search Pinecone for top 4 relevant chunks
        search_response = index.query(
            vector=query_vector,
            top_k=4,
            include_metadata=True,
            namespace=namespace
        )
        
        # 3. Extract sources and document text
        context_chunks = []
        sources = set()
        for match in search_response.matches:
            text = match.metadata.get("text", "")
            source = match.metadata.get("source", "Unknown Source")
            if text:
                context_chunks.append(text)
            if source:
                sources.add(source)
            
        context_text = "\n\n---\n\n".join(context_chunks)
        
        # Enhance with graph context
        if graph_enabled:
            graph_results = query_graph(question)
            if graph_results and graph_results != ["No specific graph context found."]:
                graph_context = "\n".join(graph_results)
                context_text = context_text + "\n\n---\nKnowledge Graph Context:\n" + graph_context
        
        if not context_text:
            return {
                "answer": "I couldn't find any relevant documents in the knowledge base. Please ingest some content first using scripts/ingest.py.",
                "sources": []
            }
            
        # Check for past corrections
        corrections = get_relevant_corrections(question)
        if corrections:
            correction_text = "\n".join([
                f"Previous correction: Q: {c['question']} → Correct answer: {c['correction']}"
                for c in corrections
            ])
            context_text = correction_text + "\n\n---\n\n" + context_text
            
        # 4. Construct the prompt for Gemini
        history_text = ""
        if history:
            history_text = "Previous conversation:\n"
            for msg in history:
                role = "User" if msg.role == "user" else "NeuralOS"
                history_text += f"{role}: {msg.content}\n"
            history_text += "\n"

        system_prompt = (
            "You are NeuralOS, an AI reasoning core that reads company documentation and answers questions.\n"
            "Answer the question based only on the provided context and conversation history. "
            "If the context doesn't contain the answer, honestly state that you don't have enough context. "
            "Keep the answer professional and factual.\n\n"
            f"Context:\n{context_text}\n\n"
            f"{history_text}"
            f"Current question: {question}\n\n"
            "Answer:"
        )
        
        # 5. Invoke LLM
        try:
            response = llm.invoke(system_prompt)
        except Exception as e:
            if "429" in str(e) and config.GEMINI_API_KEY_BACKUP:
                backup_llm = ChatGoogleGenerativeAI(
                    model="gemini-2.5-flash",
                    google_api_key=config.GEMINI_API_KEY_BACKUP,
                    temperature=0.2,
                    streaming=True
                )
                response = backup_llm.invoke(system_prompt)
            else:
                raise e
        
        return {
            "answer": response.content,
            "sources": list(sources)
        }
    except Exception as e:
        print(f"RAG query execution failed: {e}")
        return {
            "answer": f"Error executing search query: {e}. Please check your connection or API configuration.",
            "sources": []
        }

def get_mock_response(question: str):
    """
    Mock RAG query responses for demonstration when API keys are missing.
    """
    q_lower = question.lower()
    
    # Mock databases responses corresponding to frontend demo flows
    if "flipkart" in q_lower:
        return {
            "answer": "Our SLA breach with Flipkart last month was caused by a critical route optimization API timeout incident.\n\n- Impact: 47 packages delayed.\n- Root Cause: Route optimization API timed out under peak regional load.\n- Resolution: Handled dynamically by Dev Mehta (timeout threshold patched).",
            "sources": ["Notion: Flipkart Incident Post-Mortem", "Slack: #incidents"]
        }
    elif "risk" in q_lower or "client" in q_lower:
        return {
            "answer": "Flipkart is currently marked as our most at-risk client due to the recent SLA breach involving 47 delayed packages.",
            "sources": ["Notion: Flipkart Client Account", "Slack: #operations"]
        }
    elif "route" in q_lower or "api" in q_lower:
        return {
            "answer": "The Route Optimization API handles multi-point drop coordination across Mumbai sectors. Its primary vulnerability is high-latency cascading timeouts during peak operational hours (10 AM - 2 PM).",
            "sources": ["Notion: Architecture Overview", "Slack: #engineering"]
        }
    else:
        return {
            "answer": f"API keys are not configured in backend/.env. (Running in local Demo mode).\n\nYou queried: '{question}'. Set your API keys in your .env to connect to Gemini and Pinecone.",
            "sources": ["System Configuration"]
        }
async def query_rag_stream(question: str, history: list = [], namespace: str = "default"):
    """
    Streaming version of query_rag.
    Yields chunks as they come from Gemini.
    """
    global rag_enabled, index, llm, embeddings

    if not rag_enabled:
        rag_enabled = init_rag()

    if not rag_enabled or not index or not llm or not embeddings:
        mock = get_mock_response(question)
        # Stream mock response word by word
        words = mock["answer"].split(" ")
        for word in words:
            yield {"type": "text", "content": word + " "}
        yield {"type": "sources", "sources": mock["sources"]}
        return

    try:
        # 1. Embed question
        query_vector = embeddings.embed_query(question)

        # 2. Search Pinecone
        search_response = index.query(
            vector=query_vector,
            top_k=4,
            include_metadata=True,
            namespace=namespace
        )

        # 3. Extract context
        context_chunks = []
        sources = set()
        for match in search_response.matches:
            text = match.metadata.get("text", "")
            source = match.metadata.get("source", "Unknown Source")
            if text:
                context_chunks.append(text)
            if source:
                sources.add(source)

        context_text = "\n\n---\n\n".join(context_chunks)
        
        # Enhance with graph context
        if graph_enabled:
            graph_results = query_graph(question)
            if graph_results and graph_results != ["No specific graph context found."]:
                graph_context = "\n".join(graph_results)
                context_text = context_text + "\n\n---\nKnowledge Graph Context:\n" + graph_context
        
        if not context_text:
            yield {"type": "text", "content": "I couldn't find relevant documents."}
            yield {"type": "sources", "sources": []}
            return

        # Check for past corrections
        corrections = get_relevant_corrections(question)
        if corrections:
            correction_text = "\n".join([
                f"Previous correction: Q: {c['question']} → Correct answer: {c['correction']}"
                for c in corrections
            ])
            context_text = correction_text + "\n\n---\n\n" + context_text

        # 4. Build prompt
        history_text = ""
        if history:
            history_text = "Previous conversation:\n"
            for msg in history:
                role = "User" if msg.role == "user" else "NeuralOS"
                history_text += f"{role}: {msg.content}\n"
            history_text += "\n"

        system_prompt = (
            "You are NeuralOS, an AI reasoning core that reads company documentation and answers questions.\n"
            "Answer the question based only on the provided context and conversation history. "
            "If the context doesn't contain the answer, honestly state that you don't have enough context. "
            "Keep the answer professional and factual.\n\n"
            f"Context:\n{context_text}\n\n"
            f"{history_text}"
            f"Current question: {question}\n\n"
            "Answer:"
        )

        # 5. Stream from Gemini
        try:
            active_llm = llm
            async for chunk in active_llm.astream(system_prompt):
                if chunk.content:
                    yield {"type": "text", "content": chunk.content}
        except Exception as e:
            if "429" in str(e) and config.GEMINI_API_KEY_BACKUP:
                backup_llm = ChatGoogleGenerativeAI(
                    model="gemini-2.5-flash",
                    google_api_key=config.GEMINI_API_KEY_BACKUP,
                    temperature=0.2,
                    streaming=True
                )
                async for chunk in backup_llm.astream(system_prompt):
                    if chunk.content:
                        yield {"type": "text", "content": chunk.content}
            else:
                raise e
        yield {"type": "sources", "sources": list(sources)}
        return

    except Exception as e:
        yield {"type": "text", "content": f"Error: {str(e)}"}
        yield {"type": "sources", "sources": []}