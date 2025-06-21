"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const rabbitmqClient = __importStar(require("./utils/rabbitmqClient"));
const sandboxService = __importStar(require("./services/sandboxService"));
const axios_1 = __importDefault(require("axios"));
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";
const API_SERVER_URL = process.env.API_SERVER_URL || "http://localhost:8000";
const updateJobStatusOnApi = async (jobId, status, result = null) => {
    try {
        await axios_1.default.post(`${API_SERVER_URL}/code/job-update`, {
            jobId,
            status,
            result,
        });
    }
    catch (error) {
        console.error(`Worker: Failed to update status for job ${jobId} on API server:`, error);
    }
};
/**
 * Handles a single job message from RabbitMQ.
 * @param {string} msgContent - The content of the RabbitMQ message (JSON string).
 */
const handleJobMessage = async (msgContent) => {
    const { jobId, code } = JSON.parse(msgContent);
    console.log(`Worker: Received job ${jobId}`);
    await updateJobStatusOnApi(jobId, "running");
    let result;
    try {
        result = await sandboxService.executeCodeInSandbox(jobId, code);
        await updateJobStatusOnApi(jobId, "completed", result);
    }
    catch (error) {
        console.error(`Worker: Error processing job ${jobId}:`, error.message);
        result = {
            output: "",
            error: `Worker error: ${error.message}`,
            execution_trace: [],
        };
        await updateJobStatusOnApi(jobId, "error", result);
    }
};
// --- Worker Start ---
const startWorker = async () => {
    try {
        await rabbitmqClient.connectAndConsume(RABBITMQ_URL, handleJobMessage);
        console.log(`Worker process ${process.pid} started and listening for jobs.`);
    }
    catch (error) {
        console.error("Failed to start worker:", error.message);
        process.exit(1); // Exit if RabbitMQ connection fails on startup
    }
};
startWorker();
//# sourceMappingURL=index.js.map