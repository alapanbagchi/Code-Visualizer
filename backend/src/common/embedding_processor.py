# codeviz-ai/backend/src/common/embedding_processor.py

import sys
import json
import os
import uuid
from sentence_transformers import SentenceTransformer
from qdrant_client import QdrantClient
# Using models from qdrant_client.http.models for clarity and consistency
from qdrant_client.models import PointStruct, VectorParams, Distance # CHANGED LINE

# --- Configuration ---
QDRANT_HOST = os.getenv("QDRANT_URL" )
QDRANT_PORT = os.getenv("QDRANT_PORT", 6333)
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
COLLECTION_NAME = "code_trace_embeddings"
MODEL_NAME = "all-MiniLM-L6-v2"
VECTOR_SIZE = 384 

# --- Debugging ---
def debug_print(message):
    print(f"DEBUG_EMBEDDING: {message}", file=sys.stderr) # Ensure all debug prints go to stderr

# --- Main Logic ---
if __name__ == "__main__":
    debug_print("Embedding processor started.")

    # Initialize Qdrant client
    try:
        # QdrantClient(url=...) expects full URL including port if not default
        # If QDRANT_HOST is 'http://host.docker.internal', then port is part of URL
        # If QDRANT_HOST is 'host.docker.internal', then port is separate
        # Let's use the 'url' parameter for simplicity if it's a full URL, otherwise host/port
        if QDRANT_HOST and (QDRANT_HOST.startswith("http://" ) or QDRANT_HOST.startswith("https://" )):
            client = QdrantClient(url=f"{QDRANT_HOST}:{QDRANT_PORT}", api_key=QDRANT_API_KEY)
            debug_print(f"Connected to Qdrant at {QDRANT_HOST}:{QDRANT_PORT}")
        else:
            client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT, api_key=QDRANT_API_KEY)
            debug_print(f"Connected to Qdrant at {QDRANT_HOST}:{QDRANT_PORT}")

    except Exception as e:
        debug_print(f"Failed to connect to Qdrant: {e}")
        print(json.dumps({"status": "error", "message": f"Qdrant connection error: {e}"}))
        sys.exit(1)

    # Ensure collection exists and has necessary indexes
    try:
        if not client.collection_exists(COLLECTION_NAME):
            client.recreate_collection( # recreate_collection is good for dev, use create_collection for prod
                collection_name=COLLECTION_NAME,
                vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
            )
            debug_print(f"Created Qdrant collection: {COLLECTION_NAME}")
        else:
            debug_print(f"Qdrant collection already exists: {COLLECTION_NAME}")

        # --- NEW: Create payload index for job_id ---
        # This is crucial for filtering by job_id efficiently
        try:
            client.create_payload_index(
                collection_name=COLLECTION_NAME,
                field_name="job_id",
                field_schema="keyword" # Use KEYWORD for string IDs like UUIDs
            )
            debug_print(f"Payload index for 'job_id' created or already exists.")
        except Exception as e:
            # This will often error if index already exists, which is fine.
            # Only log if it's a critical error.
            debug_print(f"Warning: Could not create payload index for 'job_id'. It might already exist: {e}")

    except Exception as e:
        debug_print(f"Failed to manage Qdrant collection or index: {e}")
        print(json.dumps({"status": "error", "message": f"Qdrant collection/index error: {e}"}))
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
                # Ensure all relevant fields are present before accessing
                event_type = entry.get("event")
                line_no = entry.get("line_no")
                function_name = entry.get("function_name")
                variables = entry.get("variables", {})
                exception_type = entry.get("exception_type")
                exception_value = entry.get("exception_value")

                if event_type == "line":
                    doc_text = f"Line {line_no}: {variables}"
                elif event_type == "call":
                    doc_text = f"Call to {function_name} at line {line_no}"
                elif event_type == "return":
                    doc_text = f"Return from {function_name} at line {line_no}"
                elif event_type == "exception":
                    doc_text = f"Exception {exception_type} at line {line_no}: {exception_value}"

                if doc_text:
                    documents.append(doc_text)
                    metadatas.append({
                        "job_id": job_id,
                        "type": event_type,
                        "line_no": line_no,
                        "source": f"trace-{i}"
                    })
        except json.JSONDecodeError as e:
            debug_print(f"Invalid execution trace JSON: {e}")
            print(json.dumps({"status": "error", "message": f"Invalid trace JSON: {e}"}))
            sys.exit(1)
        except Exception as e:
            debug_print(f"Unexpected error in trace parsing: {e}")
            print(json.dumps({"status": "error", "message": f"Trace parsing error: {e}"}))
            sys.exit(1)

        if not documents:
            debug_print("No documents to embed.")
            print(json.dumps({"status": "success", "message": "No documents to embed."}))
            sys.exit(0)

        try:
            embeddings = model.encode(documents).tolist()
            points = [
                PointStruct(
                    id=str(uuid.uuid4()),  # Generate a unique UUID for each point
                    vector=embeddings[i],
                    payload=metadatas[i] | {"text": documents[i]} # Python 3.9+ for | operator
                )
                for i in range(len(documents))
            ]

            client.upsert(collection_name=COLLECTION_NAME, points=points, wait=True) # wait=True for synchronous operation
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
