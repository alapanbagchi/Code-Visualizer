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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getJobStatus = exports.updateJobStatus = exports.submitJob = void 0;
// codeviz-ai/backend/src/api/services/jobService.ts
const uuid_1 = require("uuid");
const jobStore = __importStar(require("../../common/jobStore"));
const rabbitmqClient = __importStar(require("../utils/rabbitmqClient"));
const submitJob = async (code) => {
    const jobId = (0, uuid_1.v4)();
    jobStore.setJob(jobId, "queued"); // Set initial status
    const jobPayload = { jobId, code };
    try {
        const published = rabbitmqClient.publishMessage(jobPayload);
        if (!published) {
            throw new Error("Failed to publish message to RabbitMQ.");
        }
        console.log(`API: Job ${jobId} published to RabbitMQ.`);
        return { jobId, status: "queued" };
    }
    catch (error) {
        console.error(`API: Failed to submit job ${jobId}:`, error.message);
        jobStore.setJob(jobId, "error", {
            error: "Failed to queue job",
            output: "",
            execution_trace: [],
        }); // Ensure result matches CodeExecutionResult
        throw error; // Re-throw to be caught by route handler
    }
};
exports.submitJob = submitJob;
const updateJobStatus = (jobId, status, result = null) => {
    if (!jobStore.hasJob(jobId)) {
        console.warn(`API: Attempted to update non-existent job: ${jobId}`);
        return false;
    }
    jobStore.setJob(jobId, status, result);
    console.log(`API: Job ${jobId} updated to status: ${status}`);
    return true;
};
exports.updateJobStatus = updateJobStatus;
/**
 * Retrieves a job's status and result.
 * @param {string} jobId - The ID of the job.
 * @returns {Job | undefined} The job object or undefined if not found.
 */
const getJobStatus = (jobId) => jobStore.getJob(jobId);
exports.getJobStatus = getJobStatus;
//# sourceMappingURL=jobServices.js.map