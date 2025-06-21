"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectAndConsume = void 0;
// codeviz-ai/backend/src/worker/utils/rabbitmqClient.ts
const amqplib_1 = __importDefault(require("amqplib"));
const constants_1 = require("../../common/constants");
let connection = null;
let channel = null;
const connectAndConsume = async (rabbitmqUrl, consumeCallback) => {
    if (channel)
        return channel; // Return existing channel if already connected
    try {
        connection = await amqplib_1.default.connect(rabbitmqUrl);
        channel = await connection.createChannel();
        await channel.assertQueue(constants_1.CONSTANTS.QUEUE_NAME, { durable: true });
        channel.prefetch(1); // Process one message at a time per worker
        console.log("Worker: Connected to RabbitMQ and asserted queue:", constants_1.CONSTANTS.QUEUE_NAME);
        channel.consume(constants_1.CONSTANTS.QUEUE_NAME, async (msg) => {
            if (msg !== null) {
                try {
                    await consumeCallback(msg.content.toString());
                    channel?.ack(msg); // Acknowledge message after successful processing
                }
                catch (error) {
                    console.error("Worker: Error processing message, nacking:", error.message);
                    channel?.nack(msg); // Nack message if processing fails
                }
            }
        }, { noAck: false }); // We will manually acknowledge messages
        // Handle connection close/error
        connection.on("close", () => {
            console.error("Worker: RabbitMQ connection closed! Attempting to reconnect...");
            channel = null; // Invalidate channel
            setTimeout(() => (0, exports.connectAndConsume)(rabbitmqUrl, consumeCallback), 5000); // Retry connection
        });
        connection.on("error", (err) => {
            console.error("Worker: RabbitMQ connection error:", err.message);
            channel = null; // Invalidate channel
        });
        return channel;
    }
    catch (error) {
        console.error("Worker: Failed to connect to RabbitMQ:", error.message);
        throw error; // Propagate error for initial connection failure
    }
};
exports.connectAndConsume = connectAndConsume;
//# sourceMappingURL=rabbitmqClient.js.map