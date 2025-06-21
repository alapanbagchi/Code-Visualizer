// codeviz-ai/backend/src/worker/utils/rabbitmqClient.ts
import amqp, {
  Connection,
  Channel,
  ConsumeMessage,
  ChannelModel,
} from "amqplib";
import { CONSTANTS } from "../../common/constants";

let connection: ChannelModel | null = null;
let channel: Channel | null = null;

export const connectAndConsume = async (
  rabbitmqUrl: string,
  consumeCallback: (msgContent: string) => Promise<void>
): Promise<Channel> => {
  if (channel) return channel; // Return existing channel if already connected

  try {
    connection = await amqp.connect(rabbitmqUrl);
    channel = await connection.createChannel();
    await channel.assertQueue(CONSTANTS.QUEUE_NAME, { durable: true });
    channel.prefetch(1); // Process one message at a time per worker
    console.log(
      "Worker: Connected to RabbitMQ and asserted queue:",
      CONSTANTS.QUEUE_NAME
    );

    channel.consume(
      CONSTANTS.QUEUE_NAME,
      async (msg: ConsumeMessage | null) => {
        if (msg !== null) {
          try {
            await consumeCallback(msg.content.toString());
            channel?.ack(msg); // Acknowledge message after successful processing
          } catch (error: any) {
            console.error(
              "Worker: Error processing message, nacking:",
              error.message
            );
            channel?.nack(msg); // Nack message if processing fails
          }
        }
      },
      { noAck: false }
    ); // We will manually acknowledge messages

    // Handle connection close/error
    connection.on("close", () => {
      console.error(
        "Worker: RabbitMQ connection closed! Attempting to reconnect..."
      );
      channel = null; // Invalidate channel
      setTimeout(() => connectAndConsume(rabbitmqUrl, consumeCallback), 5000); // Retry connection
    });
    connection.on("error", (err: Error) => {
      console.error("Worker: RabbitMQ connection error:", err.message);
      channel = null; // Invalidate channel
    });

    return channel;
  } catch (error: any) {
    console.error("Worker: Failed to connect to RabbitMQ:", error.message);
    throw error; // Propagate error for initial connection failure
  }
};
