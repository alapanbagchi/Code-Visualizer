import sys
import json
import os
import uuid
from sentence_transformers import SentenceTransformer
from qdrant_client import QdrantClient
from qdrant_client.http.models import PointStruct, VectorParams, Distance

# --- Configuration ---
QDRANT_HOST = os.getenv("QDRANT_URL")
QDRANT_PORT = os.getenv("QDRANT_PORT", 6333)
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
COLLECTION_NAME = "code_trace_embeddings"
MODEL_NAME = "all-MiniLM-L6-v2"
VECTOR_SIZE = 384  # Embedding size for all-MiniLM-L6-v2
# --- Debugging ---
def debug_print(message):
    print(f"DEBUG_EMBEDDING: {message}", file=sys.__stderr__)

# --- Main Logic ---
if __name__ == "__main__":
    debug_print("Embedding processor started.")

    # Initialize Qdrant client
    try:
        client = QdrantClient(url=QDRANT_HOST, port=QDRANT_PORT, api_key=QDRANT_API_KEY)
        debug_print(f"Connected to Qdrant at {QDRANT_HOST}:{QDRANT_PORT}")
    except Exception as e:
        debug_print(f"Failed to connect to Qdrant: {e}")
        print(json.dumps({"status": "error", "message": f"Qdrant connection error: {e}"}))
        sys.exit(1)

    # Ensure collection exists
    try:
        if not client.collection_exists(COLLECTION_NAME):
            client.recreate_collection(
                collection_name=COLLECTION_NAME,
                vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
            )
            debug_print(f"Created Qdrant collection: {COLLECTION_NAME}")
        else:
            debug_print(f"Qdrant collection already exists: {COLLECTION_NAME}")
    except Exception as e:
        debug_print(f"Failed to create/get Qdrant collection: {e}")
        print(json.dumps({"status": "error", "message": f"Qdrant collection error: {e}"}))
        sys.exit(1)

    # Load model
    try:
        model = SentenceTransformer(MODEL_NAME)
        debug_print(f"Loaded model: {MODEL_NAME}")
    except Exception as e:
        debug_print(f"Failed to load model: {e}")
        print(json.dumps({"status": "error", "message": f"Model load error: {e}"}))
        sys.exit(1)

    # Parse arguments
    mode = sys.argv[1] if len(sys.argv) > 1 else "process"

    if mode == "process":
        if len(sys.argv) < 5:
            debug_print("Usage: python embedding_processor.py process <job_id> <code> <execution_trace_json>")
            print(json.dumps({"status": "error", "message": "Missing arguments for process mode."}))
            sys.exit(1)

        job_id = sys.argv[2]
        code = sys.argv[3]
        execution_trace_json = sys.argv[4]
        debug_print(f"Processing job: {job_id}")

        documents = []
        metadatas = []

        # Add the code itself
        documents.append(code)
        metadatas.append({"job_id": job_id, "type": "code", "line_no": 0, "source": "job-code"})

        # Parse and embed execution trace
        try:
            trace = json.loads(execution_trace_json)
            for i, entry in enumerate(trace):
                doc_text = ""
                if entry["event"] == "line":
                    doc_text = f"Line {entry['line_no']}: {entry.get('variables', {})}"
                elif entry["event"] == "call":
                    doc_text = f"Call to {entry['function_name']} at line {entry['line_no']}"
                elif entry["event"] == "return":
                    doc_text = f"Return from {entry['function_name']} at line {entry['line_no']}"
                elif entry["event"] == "exception":
                    doc_text = f"Exception {entry['exception_type']} at line {entry['line_no']}: {entry['exception_value']}"

                if doc_text:
                    documents.append(doc_text)
                    metadatas.append({
                        "job_id": job_id,
                        "type": entry["event"],
                        "line_no": entry["line_no"],
                        "source": f"trace-{i}"
                    })
        except json.JSONDecodeError as e:
            debug_print(f"Invalid execution trace JSON: {e}")
        except Exception as e:
            debug_print(f"Unexpected error in trace parsing: {e}")

        if not documents:
            debug_print("No documents to embed.")
            print(json.dumps({"status": "success", "message": "No documents to embed."}))
            sys.exit(0)

        try:
            embeddings = model.encode(documents).tolist()
            points = [
                PointStruct(
                    id=str(uuid.uuid4()),  # UUID string is valid for Qdrant
                    vector=embeddings[i],
                    payload=metadatas[i] | {"text": documents[i]}
                )
                for i in range(len(documents))
            ]

            client.upsert(collection_name=COLLECTION_NAME, points=points)
            debug_print(f"Stored {len(points)} embeddings in Qdrant.")
            print(json.dumps({"status": "success", "message": f"Embeddings stored for job {job_id}."}))
        except Exception as e:
            debug_print(f"Failed to store embeddings: {e}")
            print(json.dumps({"status": "error", "message": f"Storage error: {e}"}))
            sys.exit(1)

    else:
        debug_print(f"Unknown mode: {mode}")
        print(json.dumps({"status": "error", "message": f"Unknown mode: {mode}. Only 'process' is implemented."}))
        sys.exit(1)

    debug_print("Embedding processor finished.")