"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishMessage = exports.connect = exports.channel = void 0;
const amqplib_1 = __importDefault(require("amqplib"));
const constants_1 = require("../../common/constants");
let connection = null;
exports.channel = null;
const connect = async (rabbitmqUrl) => {
    if (exports.channel)
        return exports.channel; // Return existing channel if already connected
    try {
        connection = await amqplib_1.default.connect(rabbitmqUrl);
        exports.channel = await connection.createChannel();
        await exports.channel.assertQueue(constants_1.CONSTANTS.QUEUE_NAME, { durable: true });
        console.log("API: Connected to RabbitMQ and asserted queue:", constants_1.CONSTANTS.QUEUE_NAME);
        // Handle connection close/error
        connection.on("close", () => {
            console.error("API: RabbitMQ connection closed! Attempting to reconnect...");
            exports.channel = null; // Invalidate channel
            setTimeout(() => (0, exports.connect)(rabbitmqUrl), 5000); // Retry connection
        });
        connection.on("error", (err) => {
            console.error("API: RabbitMQ connection error:", err.message);
            exports.channel = null; // Invalidate channel
        });
        return exports.channel;
    }
    catch (error) {
        console.error("API: Failed to connect to RabbitMQ:", error.message);
        throw error; // Propagate error for initial connection failure
    }
};
exports.connect = connect;
const publishMessage = (message) => {
    if (!exports.channel) {
        console.error("API: Cannot publish message, RabbitMQ channel not available.");
        return false;
    }
    return exports.channel.sendToQueue(constants_1.CONSTANTS.QUEUE_NAME, Buffer.from(JSON.stringify(message)), {
        persistent: true,
    });
};
exports.publishMessage = publishMessage;
//# sourceMappingURL=rabbitmqClient.js.map