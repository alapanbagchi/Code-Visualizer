# codeviz-ai/backend/src/common/embedding_processor.py
import sys
import json
import os
from sentence_transformers import SentenceTransformer
import chromadb
from chromadb.utils import embedding_functions

# --- Configuration ---
# Use host.docker.internal for Docker Desktop to reach host services
# For Linux Docker, you might need to use the host's actual IP or a shared network
CHROMA_HOST = os.getenv('CHROMA_HOST', 'host.docker.internal' )
CHROMA_PORT = os.getenv('CHROMA_PORT', '8000')
CHROMA_URL = f"http://{CHROMA_HOST}:{CHROMA_PORT}"
COLLECTION_NAME = "code_trace_embeddings"
MODEL_NAME = "all-MiniLM-L6-v2" # A good balance of size and performance

# --- Debugging ---
def debug_print(message ):
    print(f"DEBUG_EMBEDDING: {message}", file=sys.__stderr__)

# --- Main Logic ---
if __name__ == "__main__":
    debug_print("Embedding processor started.")

    # Initialize ChromaDB client
    try:
        client = chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)
        # Ping to ensure connection
        client.heartbeat()
        debug_print(f"Connected to ChromaDB at {CHROMA_URL}")
    except Exception as e:
        debug_print(f"Failed to connect to ChromaDB: {e}")
        print(json.dumps({"status": "error", "message": f"ChromaDB connection error: {e}"}))
        sys.exit(1)

    # Get or create collection
    try:
        # Use a default embedding function for the collection, but we'll use our own model
        # This is a bit of a workaround for chromadb's client requiring an embedding function
        # even if you provide embeddings directly.
        default_ef = embedding_functions.SentenceTransformerEmbeddingFunction(model_name=MODEL_NAME)
        collection = client.get_or_create_collection(
            name=COLLECTION_NAME,
            embedding_function=default_ef # Pass the embedding function here
        )
        debug_print(f"Accessed ChromaDB collection: {COLLECTION_NAME}")
    except Exception as e:
        debug_print(f"Failed to get/create ChromaDB collection: {e}")
        print(json.dumps({"status": "error", "message": f"ChromaDB collection error: {e}"}))
        sys.exit(1)

    # Load SentenceTransformer model
    try:
        model = SentenceTransformer(MODEL_NAME)
        debug_print(f"Loaded SentenceTransformer model: {MODEL_NAME}")
    except Exception as e:
        debug_print(f"Failed to load SentenceTransformer model: {e}")
        print(json.dumps({"status": "error", "message": f"SentenceTransformer model load error: {e}"}))
        sys.exit(1)

    # Input from worker via command line arguments
    # sys.argv[1] will be the mode ('process' or 'query')
    # sys.argv[2] will be job_id
    # sys.argv[3] will be code
    # sys.argv[4] will be execution_trace_json

    mode = sys.argv[1] if len(sys.argv) > 1 else "process" # Default to process for now

    if mode == "process":
        if len(sys.argv) < 5: # Expecting mode, job_id, code, trace_json
            debug_print("Usage: python embedding_processor.py process <job_id> <code> <execution_trace_json>")
            print(json.dumps({"status": "error", "message": "Missing arguments for process mode."}))
            sys.exit(1)

        job_id = sys.argv[2]
        code = sys.argv[3]
        execution_trace_json = sys.argv[4]
        debug_print(f"Processing job_id: {job_id}")

        documents = []
        metadatas = []
        ids = []

        # 1. Embed the entire code
        documents.append(code)
        metadatas.append({"job_id": job_id, "type": "code", "line_no": 0})
        ids.append(f"{job_id}-code")

        # 2. Embed key parts of the execution trace
        try:
            trace = json.loads(execution_trace_json)
            for i, entry in enumerate(trace):
                doc_text = ""
                if entry['event'] == 'line':
                    # Include variables in the document text for better context
                    doc_text = f"Line {entry['line_no']}: {entry.get('variables', {})}"
                elif entry['event'] == 'call':
                    doc_text = f"Call to {entry['function_name']} at line {entry['line_no']}"
                elif entry['event'] == 'return':
                    doc_text = f"Return from {entry['function_name']} at line {entry['line_no']}"
                elif entry['event'] == 'exception':
                    doc_text = f"Exception {entry['exception_type']} at line {entry['line_no']}: {entry['exception_value']}"

                if doc_text:
                    documents.append(doc_text)
                    metadatas.append({"job_id": job_id, "type": entry['event'], "line_no": entry['line_no']})
                    ids.append(f"{job_id}-trace-{i}")
        except json.JSONDecodeError as e:
            debug_print(f"Error decoding execution trace JSON: {e}")
            # Don't exit, just log and continue without trace embeddings
        except Exception as e:
            debug_print(f"Unexpected error processing trace: {e}")


        if not documents:
            debug_print("No documents to add to ChromaDB.")
            print(json.dumps({"status": "success", "message": "No documents to embed."}))
            sys.exit(0)

        try:
            embeddings = model.encode(documents).tolist()
            collection.add(
                embeddings=embeddings,
                documents=documents,
                metadatas=metadatas,
                ids=ids
            )
            debug_print(f"Added {len(documents)} embeddings for job {job_id} to ChromaDB.")
            print(json.dumps({"status": "success", "message": f"Embeddings generated and stored for job {job_id}."}))
        except Exception as e:
            debug_print(f"Error adding embeddings to ChromaDB: {e}")
            print(json.dumps({"status": "error", "message": f"Failed to store embeddings: {e}"}))
            sys.exit(1)
    # We'll implement the 'query' mode later (e.g., Day 5/6)
    else:
        debug_print(f"Unknown mode: {mode}")
        print(json.dumps({"status": "error", "message": f"Unknown mode: {mode}. Only 'process' is implemented."}))
        sys.exit(1)

    debug_print("Embedding processor finished.")
