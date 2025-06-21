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
const jobService = __importStar(require("../services/jobServices"));
const CodeExecutionController = {
    executeCode: async (req, res) => {
        const code = req.body.code;
        if (!code) {
            return res.status(400).json({ error: "Code is required" });
        }
        try {
            const job = await jobService.submitJob(code);
            res.json(job);
        }
        catch (error) {
            res
                .status(500)
                .json({ error: "Failed to submit job", details: error.message });
        }
    },
    jobUpdate: async (req, res) => {
        const { jobId, status, result } = req.body;
        if (!jobId || !status) {
            return res.status(400).json({ error: "jobId and status are required" });
        }
        const updated = jobService.updateJobStatus(jobId, status, result || null);
        if (updated) {
            res.json({ success: true });
        }
        else {
            res.status(404).json({ error: "Job not found" });
        }
    },
    jobStatus: async (req, res) => {
        const { jobId } = req.params;
        const job = jobService.getJobStatus(jobId);
        if (!job) {
            return res.status(404).json({ error: "Job not found" });
        }
        res.json(job);
    },
};
exports.default = CodeExecutionController;
//# sourceMappingURL=codeExecution.controller.js.map