"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const codeExecution_controller_1 = __importDefault(require("../controller/codeExecution.controller"));
const router = (0, express_1.Router)();
router.post("/execute-code", async (req, res) => {
    codeExecution_controller_1.default.executeCode(req, res);
});
router.post("/job-update", (req, res) => {
    console.log("API: Received job update request");
    codeExecution_controller_1.default.jobUpdate(req, res);
});
router.get("/status/:jobId", (req, res) => {
    codeExecution_controller_1.default.jobStatus(req, res);
});
exports.default = router;
//# sourceMappingURL=codeExecution.router.js.map