import amqp, { Connection, Channel, ChannelModel } from "amqplib";
import { CONSTANTS } from "../../common/constants";
import { JobPayload } from "../../common/types";

let connection: ChannelModel | null = null;
export let channel: Channel | null = null;

export const connect = async (rabbitmqUrl: string): Promise<Channel> => {
  if (channel) return channel; // Return existing channel if already connected

  try {
    connection = await amqp.connect(rabbitmqUrl);
    channel = await connection.createChannel();
    await channel.assertQueue(CONSTANTS.QUEUE_NAME, { durable: true });
    console.log(
      "API: Connected to RabbitMQ and asserted queue:",
      CONSTANTS.QUEUE_NAME
    );

    // Handle connection close/error
    connection.on("close", () => {
      console.error(
        "API: RabbitMQ connection closed! Attempting to reconnect..."
      );
      channel = null; // Invalidate channel
      setTimeout(() => connect(rabbitmqUrl), 5000); // Retry connection
    });
    connection.on("error", (err: Error) => {
      console.error("API: RabbitMQ connection error:", err.message);
      channel = null; // Invalidate channel
    });

    return channel;
  } catch (error: any) {
    console.error("API: Failed to connect to RabbitMQ:", error.message);
    throw error; // Propagate error for initial connection failure
  }
};

export const publishMessage = (message: JobPayload): boolean => {
  if (!channel) {
    console.error(
      "API: Cannot publish message, RabbitMQ channel not available."
    );
    return false;
  }
  console.log("RABBITMQ:", message);
  return channel.sendToQueue(
    CONSTANTS.QUEUE_NAME,
    Buffer.from(JSON.stringify(message)),
    {
      persistent: true,
    }
  );
};
