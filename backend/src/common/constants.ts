export const CONSTANTS = {
  QUEUE_NAME: "code_execution_jobs",
  SANDBOX_IMAGE: "sandbox-python",
  EXECUTION_TIMEOUT_SECONDS: 20,
  CHROMA_HOST: process.env.CHROMA_HOST || "host.docker.internal",
  CHROMA_PORT: process.env.CHROMA_PORT || "8000",
};
