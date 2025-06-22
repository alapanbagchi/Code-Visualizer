import express, { Request, Response } from "express";
import dotenv from "dotenv";
import CodeExecutionRoutes from "./routes/codeExecution.router";
import * as rabbitmqClient from "./utils/rabbitmqClient";
import cors from "cors";
import db from "../common/db";
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;
const RABBITMQ_URL =
  process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";

// Middlewares
app.use(express.json());
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.get("/", async (req, res) => {
  res.status(200).json({ status: 200, data: null, message: "API is healthy" });
});

app.use("/code", CodeExecutionRoutes);

const startApiServer = async () => {
  try {
    await rabbitmqClient.connect(RABBITMQ_URL);
    await db.query("SELECT 1");
    console.log("API: Connected to PostgreSQL");
    app.listen(PORT, () => {
      console.log(`API server listening on port ${PORT}`);
    });
  } catch (error: any) {
    console.error("Failed to start API server:", error.message);
    process.exit(1);
  }
};

startApiServer();
