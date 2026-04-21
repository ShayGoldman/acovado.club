import { makeEvent } from '@modules/events';
import type { Producer } from '@modules/events';
import { connectToBroker, makeBoundLogger, safeClose } from '@modules/events';
import { makeId } from '@modules/ids';
import type { Logger } from '@modules/logger';
import type { Tracer } from '@modules/tracing';
import type { Channel, Connection, ConsumeMessage } from 'amqplib';
import type {
  RedditApiRequest,
  RedditApiRequestEvent,
  RedditApiResponse,
  RedditApiResponseEvent,
} from './reddit-api-types';

export interface MakeRedditApiQueueClientOpts {
  broker: string;
  logger: Logger;
  tracer: Tracer;
  producer: Producer;
}

type Callback<T extends RedditApiRequest> = (
  result:
    | { success: true; data: RedditApiResponse<T> }
    | { success: false; error: Error },
) => void;

export type RedditApiQueueClient = ReturnType<typeof makeRedditApiQueueClient>;

export function makeRedditApiQueueClient(opts: MakeRedditApiQueueClientOpts) {
  const { broker, logger, tracer, producer } = opts;
  const boundLogger = makeBoundLogger(logger);
  const callbacks = new Map<string, Callback<any>>();
  let connection: Connection | null = null;
  let responseChannel: Channel | null = null;
  let responseConsumerTag: string | null = null;
  const domain = 'reddit';
  const responseQueueName = `${domain}:api-call-responses`;

  async function ensureResponseConsumer(): Promise<void> {
    if (responseChannel && responseConsumerTag) {
      return;
    }

    return tracer.with('Setup response consumer', async (ctx) => {
      if (!connection) {
        connection = await connectToBroker(broker, boundLogger);
      }

      if (!connection) {
        throw new Error('Failed to establish RabbitMQ connection');
      }

      const channel = await connection.createChannel();
      responseChannel = channel;
      const exchange = `${domain}.exchange`;

      await channel.assertExchange(exchange, 'topic', { durable: true });
      await channel.assertQueue(responseQueueName, {
        durable: false,
        autoDelete: true,
      });

      // Bind to all response routing keys
      await channel.bindQueue(responseQueueName, exchange, 'reddit.api-call.*.succeeded');
      await channel.bindQueue(responseQueueName, exchange, 'reddit.api-call.*.failed');

      await channel.prefetch(1);

      const consumeResult = await channel.consume(
        responseQueueName,
        async (msg: ConsumeMessage | null) => {
          if (!msg) return;

          try {
            const content = JSON.parse(msg.content.toString()) as RedditApiResponseEvent;
            const requestId = content.data.requestId;

            const callback = callbacks.get(requestId);
            if (callback) {
              ctx.log.debug(
                { requestId, responseType: content.type },
                'Found callback for response',
              );
              if (content.type.endsWith('.succeeded')) {
                callback({
                  success: true,
                  data: content.data.responseData as RedditApiResponse<any>,
                });
              } else {
                callback({
                  success: false,
                  error: new Error(content.data.error?.message || 'Unknown error'),
                });
              }
              callbacks.delete(requestId);
            } else {
              ctx.log.warn(
                {
                  requestId,
                  responseType: content.type,
                  handlerId: (content.data.metadata as { handlerId?: string } | undefined)
                    ?.handlerId,
                  callbackCount: callbacks.size,
                },
                'Received response but no callback found (client may have restarted)',
              );
            }

            channel.ack(msg);
          } catch (error) {
            ctx.log.error({ error }, 'Error processing response message');
            channel.nack(msg, false, false);
          }
        },
        { noAck: false },
      );

      responseConsumerTag = consumeResult.consumerTag;

      ctx.log.info(
        { queue: responseQueueName, consumerTag: responseConsumerTag },
        'Response consumer set up',
      );
    });
  }

  async function connect(): Promise<void> {
    return tracer.with('Connect Reddit API queue client', async (ctx) => {
      await ensureResponseConsumer();
      ctx.log.info('Reddit API queue client connected');
    });
  }

  async function disconnect(): Promise<void> {
    if (responseChannel && responseConsumerTag) {
      await responseChannel.cancel(responseConsumerTag);
      await safeClose(responseChannel, 'response.channel', boundLogger);
      responseChannel = null;
      responseConsumerTag = null;
    }
    if (connection) {
      await safeClose(connection, 'client.connection', boundLogger);
      connection = null;
    }
    callbacks.clear();
  }

  async function publishRequest<T extends RedditApiRequest>(
    request: T,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    return tracer.with('Publish Reddit API request', async (ctx) => {
      const requestId = makeId({ prefix: 'req', length: 32 });
      const handlerId = (metadata as { handlerId?: string } | undefined)?.handlerId;

      ctx.annotate('request.id', requestId);
      ctx.annotate('request.type', request.type);
      ctx.annotate('request.handlerId', handlerId || 'none');

      // Create request event
      const event = makeEvent('api-call', 'requested', {
        id: requestId,
        requestId,
        type: request.type,
        params: request.params,
        metadata,
      }) as RedditApiRequestEvent;

      // Publish request
      await producer.send(domain, 'reddit.api-call.requested', event);

      ctx.log.info(
        {
          requestId,
          type: request.type,
          handlerId,
          params: request.params,
        },
        'Reddit API request published',
      );

      return requestId;
    });
  }

  return {
    connect,
    publishRequest,
    disconnect,
  };
}
