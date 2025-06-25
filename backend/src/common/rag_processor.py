# codeviz-ai/backend/src/common/rag_processor.py

import sys
import json
import os
from qdrant_client import QdrantClient
from qdrant_client.http.models import Filter, FieldCondition, MatchValue
from sentence_transformers import SentenceTransformer
from openai import OpenAI # Use OpenAI client for Ollama's compatible API

# --- Configuration ---
QDRANT_URL = os.getenv("QDRANT_URL" )
QDRANT_PORT = os.getenv("QDRANT_PORT", 6333)
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
COLLECTION_NAME = "code_trace_embeddings"
EMBEDDING_MODEL_NAME = "all-MiniLM-L6-v2"
VECTOR_SIZE = 384 # Embedding size for all-MiniLM-L6-v2

LLM_PROVIDER = os.getenv("LLM_PROVIDER", "ollama") # Read from env
LLM_API_KEY = os.getenv("LLM_API_KEY") # Read from env
LLM_MODEL_NAME = os.getenv("LLM_MODEL_NAME", "llama2") # Read from env
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://host.docker.internal:11434/v1" ) # Read from env

TOP_K_RETRIEVAL = 5 # Number of top relevant snippets to retrieve

# --- Debugging ---
def debug_print(message):
    print(f"DEBUG_RAG: {message}", file=sys.stderr)

# --- Main Logic ---
if __name__ == "__main__":
    debug_print("RAG processor started.")

    # Parse arguments
    mode = sys.argv[1] if len(sys.argv) > 1 else None

    if mode == "query":
        if len(sys.argv) < 3:
            debug_print("Usage: python rag_processor.py query <natural_language_query>")
            print(json.dumps({"status": "error", "message": "Missing query argument."}))
            sys.exit(1)

        natural_language_query = sys.argv[2]
        debug_print(f"Received query: {natural_language_query}")

        try:
            # 1. Initialize Qdrant client
            qdrant_client = QdrantClient(
                url=QDRANT_URL,
                port=QDRANT_PORT,
                api_key=QDRANT_API_KEY,
                timeout=10
            )
            debug_print(f"Connected to Qdrant at {QDRANT_URL}:{QDRANT_PORT}")

            # 2. Load embedding model
            embedding_model = SentenceTransformer(EMBEDDING_MODEL_NAME)
            debug_print(f"Loaded embedding model: {EMBEDDING_MODEL_NAME}")

            # 3. Generate embedding for the query
            query_embedding = embedding_model.encode(natural_language_query).tolist()
            debug_print("Generated query embedding.")

            # 4. Perform semantic search in Qdrant
            search_results = qdrant_client.search(
                collection_name=COLLECTION_NAME,
                query_vector=query_embedding,
                limit=TOP_K_RETRIEVAL,
                with_payload=True, # Retrieve the original content
                with_vectors=False # No need for vectors in response
            )
            debug_print(f"Retrieved {len(search_results)} relevant snippets from Qdrant.")

            # 5. Extract relevant context
            context_snippets = []
            for hit in search_results:
                payload = hit.payload
                content_type = payload.get("type", "unknown")
                text_content = payload.get("text", "")
                job_id = payload.get("job_id", "N/A")
                line_no = payload.get("line_no", "N/A")

                if content_type == "code":
                    context_snippets.append(f"Code Snippet (Job ID: {job_id}):\n```python\n{text_content}\n```")
                elif content_type == "trace_entry":
                    context_snippets.append(f"Execution Trace (Job ID: {job_id}, Type: {payload.get('type')}, Line: {line_no}):\n```\n{text_content}\n```")
                else:
                    context_snippets.append(f"Relevant Snippet (Job ID: {job_id}):\n```\n{text_content}\n```")

            context_str = "\n\n".join(context_snippets)
            debug_print("Constructed context string.")

            # 6. Construct prompt for LLM
            system_prompt = (
                "You are an AI assistant specialized in explaining Python code and its execution. "
                "Use the provided code snippets and execution traces as context to answer the user's question. "
                "If the context does not contain enough information, state that you cannot answer based on the provided context. "
                "Be concise and directly answer the question."
            )
            user_prompt = (
                f"Based on the following context, answer the question:\n\n"
                f"Context:\n{context_str}\n\n"
                f"Question: {natural_language_query}\n\n"
                f"Answer:"
            )
            debug_print("Constructed LLM prompt.")

            # 7. Call LLM API (MODIFIED for Ollama)
            llm_response = ""
            if LLM_PROVIDER == "ollama":
                # Ollama can be used via OpenAI-compatible API
                ollama_client = OpenAI(api_key=LLM_API_KEY, base_url=LLM_BASE_URL) # API key can be anything for local Ollama
                chat_completion = ollama_client.chat.completions.create(
                    model=LLM_MODEL_NAME,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    temperature=0.7,
                    max_tokens=500
                )
                llm_response = chat_completion.choices[0].message.content
            else:
                raise ValueError(f"Unsupported LLM_PROVIDER: {LLM_PROVIDER}. Only 'ollama' is supported in this configuration.")

            debug_print("Received response from LLM.")
            print(json.dumps({"status": "success", "answer": llm_response}))

        except Exception as e:
            debug_print(f"Error during RAG query processing: {e}")
            print(json.dumps({"status": "error", "message": f"RAG query error: {e}"}))
            sys.exit(1)
    else:
        debug_print(f"Unknown mode: {mode}. Only 'query' is implemented.")
        print(json.dumps({"status": "error", "message": f"Unknown mode: {mode}. Only 'query' is implemented."}))
        sys.exit(1)

    debug_print("RAG processor finished.")
