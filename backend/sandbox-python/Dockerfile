FROM python:3.13.5-bookworm

# Set the working directory inside the container
WORKDIR /mnt

RUN pip install --no-cache-dir \
    "torch==2.7.0+cpu" -f https://download.pytorch.org/whl/torch/ \
    "sentence-transformers==2.7.0" \
    "chromadb==0.5.0" \
    "numpy==1.26.4"


# Set environment variable for unbuffered Python output
ENV PYTHONUNBUFFERED 1

# Copy tracer.py and embedding_processor.py into the container
# These paths are now relative to the 'backend' directory, which will be the build context
COPY src/common/tracer.py /mnt/tracer.py
COPY src/common/embedding_processor.py /mnt/embedding_processor.py

# Set a default command, though we'll override it with docker run
# This CMD is primarily for keeping the container alive if run without an explicit command
CMD ["sleep", "infinity"]