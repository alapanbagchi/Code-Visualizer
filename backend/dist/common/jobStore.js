"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasJob = exports.getJob = exports.setJob = void 0;
const jobStore = new Map();
const setJob = (jobId, status, result) => {
    const currentJob = jobStore.get(jobId) || {};
    const updatedJob = { ...currentJob, status, result };
    jobStore.set(jobId, updatedJob);
    return updatedJob;
};
exports.setJob = setJob;
const getJob = (jobId) => {
    return jobStore.get(jobId) || {};
};
exports.getJob = getJob;
const hasJob = (jobId) => jobStore.has(jobId);
exports.hasJob = hasJob;
//# sourceMappingURL=jobStore.js.map