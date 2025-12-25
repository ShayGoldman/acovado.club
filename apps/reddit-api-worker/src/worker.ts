import { makeEvent, type Producer } from '@modules/events';
import type { Logger } from '@modules/logger';
import type { Tracer } from '@modules/tracing';
import { makeRedditClient } from '@modules/reddit-client';
import type amqp from 'amqplib';
import {
  connectToBroker,
  initializeChannel,
  makeBoundLogger,
  safeClose,
} from '@modules/events';
import { calculateRetryDelay } from './rate-limit-handler';
import type {
  RedditApiRequestEvent,
  RedditApiResponseEvent,
} from '@modules/reddit-client';

export interface MakeRedditApiQueueWorkerOpts {
  broker: string;
  logger: Logger;
  tracer: Tracer;
  producer: Producer;
  maxRetries?: number;
}

const MAX_RETRIES = 10;
const RETRY_EXCHANGE = 'reddit-api.retry';
const DOMAIN = 'reddit';

export type RedditApiQueueWorker = ReturnType<typeof makeRedditApiQueueWorker>;

export function makeRedditApiQueueWorker(opts: MakeRedditApiQueueWorkerOpts) {
  const { broker, logger, tracer, producer } = opts;
  const maxRetries = opts.maxRetries ?? MAX_RETRIES;
  const boundLogger = makeBoundLogger(logger);
  let connection: amqp.Connection | null = null;
  let requestChannel: amqp.Channel | null = null;
  let retryChannel: amqp.Channel | null = null;
  let retryConnection: amqp.Connection | null = null; // Separate connection for retry channel
  let consumerTag: string | null = null;
  const redditClient = makeRedditClient({ logger: boundLogger });

  async function setupRetryExchange(): Promise<void> {
    if (retryChannel) {
      // Check if channel is still open by trying to check the exchange
      try {
        await retryChannel.checkExchange(RETRY_EXCHANGE);
        return; // Channel is still valid
      } catch (error: any) {
        // Channel might be closed, need to recreate
        boundLogger.warn(
          { error, errorMessage: error?.message },
          'Retry channel may be closed, recreating',
        );
        retryChannel = null;
      }
    }

    if (!retryChannel) {
      // Use separate connection for retry channel to avoid affecting main connection
      if (!retryConnection) {
        retryConnection = await connectToBroker(broker, boundLogger);

        // Set up connection error handlers
        retryConnection.on('error', (error) => {
          boundLogger.error({ error }, 'Retry connection error');
        });

        retryConnection.on('close', () => {
          boundLogger.warn('Retry connection closed');
          retryConnection = null;
          retryChannel = null;
        });
      }

      try {
        retryChannel = await retryConnection.createChannel();

        // Set up error handler for the channel
        retryChannel.on('error', (error) => {
          boundLogger.error({ error }, 'Retry channel error');
        });

        retryChannel.on('close', () => {
          boundLogger.warn('Retry channel closed');
          retryChannel = null;
        });

        // Assert delayed message exchange
        await retryChannel.assertExchange(RETRY_EXCHANGE, 'x-delayed-message', {
          durable: true,
          arguments: {
            'x-delayed-type': 'topic',
          },
        });

        boundLogger.debug(
          { exchange: RETRY_EXCHANGE },
          'Delayed message exchange asserted',
        );
      } catch (error: any) {
        const errorMessage = error?.message || String(error);
        boundLogger.error(
          {
            error,
            exchange: RETRY_EXCHANGE,
            errorMessage,
            errorCode: error?.code,
          },
          'Failed to set up retry exchange - delayed message plugin may not be enabled',
        );

        // Clean up the channel if it was created
        if (retryChannel) {
          try {
            await safeClose(retryChannel, 'retry.channel', boundLogger);
          } catch {
            // Ignore close errors
          }
          retryChannel = null;
        }

        throw new Error(
          `Failed to set up retry exchange: ${errorMessage}. Ensure rabbitmq_delayed_message_exchange plugin is enabled in RabbitMQ.`,
        );
      }

      // Assert main exchange (needed for publishing retries back)
      const mainExchange = `${DOMAIN}.exchange`;
      await retryChannel.assertExchange(mainExchange, 'topic', { durable: true });

      // Create a queue that consumes from retry exchange and republishes to main exchange
      const retryQueue = `${DOMAIN}:api-call-retries`;
      await retryChannel.assertQueue(retryQueue, { durable: true });
      await retryChannel.bindQueue(
        retryQueue,
        RETRY_EXCHANGE,
        'reddit.api-call.requested',
      );

      // Consume from retry queue and republish to main exchange
      await retryChannel.consume(
        retryQueue,
        async (msg) => {
          if (!msg) return;

          try {
            const content = msg.content.toString();
            const headers = msg.properties.headers || {};

            // Republish to main exchange
            await retryChannel!.publish(
              mainExchange,
              'reddit.api-call.requested',
              Buffer.from(content),
              {
                headers,
              },
            );

            retryChannel?.ack(msg);
          } catch (error) {
            boundLogger.error({ error }, 'Error republishing retry message');
            retryChannel?.nack(msg, false, true);
          }
        },
        { noAck: false },
      );

      boundLogger.info(
        { exchange: RETRY_EXCHANGE, queue: retryQueue },
        'Retry exchange set up',
      );
    }
  }

  async function publishRetry(
    event: RedditApiRequestEvent,
    delayMs: number,
    retryCount: number,
  ): Promise<void> {
    return tracer.with('Publish retry', async (ctx) => {
      try {
        await setupRetryExchange();

        if (!retryChannel) {
          throw new Error('Retry channel not initialized');
        }

        // Ensure channel is still open before publishing
        if (!retryChannel) {
          ctx.log.warn(
            { requestId: event.data.requestId },
            'Retry channel is null, recreating before publish',
          );
          await setupRetryExchange();
          if (!retryChannel) {
            throw new Error('Failed to create retry channel');
          }
        }

        // Check if channel is still open
        try {
          await retryChannel.checkExchange(RETRY_EXCHANGE);
        } catch (checkError: any) {
          ctx.log.warn(
            { error: checkError, requestId: event.data.requestId },
            'Retry channel appears closed, recreating before publish',
          );
          retryChannel = null;
          await setupRetryExchange();
          if (!retryChannel) {
            throw new Error('Failed to recreate retry channel');
          }
        }

        const headers: Record<string, string> = {
          'x-retry-count': String(retryCount),
          'x-delay': String(Math.round(delayMs)), // Ensure integer milliseconds
        };

        ctx.log.debug(
          {
            requestId: event.data.requestId,
            exchange: RETRY_EXCHANGE,
            delayMs: Math.round(delayMs),
            retryCount,
          },
          'Publishing to delayed message exchange',
        );

        const published = retryChannel.publish(
          RETRY_EXCHANGE,
          'reddit.api-call.requested',
          Buffer.from(JSON.stringify(event)),
          {
            headers,
            persistent: true,
            // x-delayed-message plugin uses x-delay header for delay
          },
        );

        if (!published) {
          // Channel buffer is full, wait a bit and retry
          ctx.log.warn(
            { requestId: event.data.requestId },
            'Channel buffer full, waiting before retry publish',
          );
          await new Promise((resolve) => setTimeout(resolve, 100));
          // Try once more
          const retryPublished = retryChannel.publish(
            RETRY_EXCHANGE,
            'reddit.api-call.requested',
            Buffer.from(JSON.stringify(event)),
            {
              headers,
              persistent: true,
            },
          );
          if (!retryPublished) {
            throw new Error('Failed to publish retry message - channel buffer full');
          }
        }

        ctx.log.info(
          {
            requestId: event.data.requestId,
            delayMs: Math.round(delayMs),
            retryCount,
            exchange: RETRY_EXCHANGE,
          },
          'Published retry request',
        );
      } catch (error: any) {
        ctx.log.error(
          {
            error,
            requestId: event.data.requestId,
            delayMs,
            retryCount,
            errorMessage: error?.message,
          },
          'Failed to publish retry request',
        );
        // Reset channel so it gets recreated on next attempt
        if (retryChannel) {
          try {
            await safeClose(retryChannel, 'retry.channel', boundLogger);
          } catch {
            // Ignore close errors
          }
          retryChannel = null;
        }
        throw error;
      }
    });
  }

  async function publishResponse(
    requestId: string,
    success: boolean,
    data?: unknown,
    error?: { message: string; code?: string; retryCount?: number },
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    return tracer.with('Publish response', async (ctx) => {
      const lifecycle = success ? ('succeeded' as const) : ('failed' as const);
      const resource = `api-call.${requestId}` as Lowercase<string>;

      ctx.annotate('response.requestId', requestId);
      ctx.annotate('response.lifecycle', lifecycle);
      ctx.annotate('response.hasData', !!data);
      ctx.annotate('response.hasError', !!error);
      ctx.annotate(
        'response.handlerId',
        ((metadata as { handlerId?: string } | undefined)?.handlerId as string) || 'none',
      );

      const event = makeEvent(resource, lifecycle, {
        id: requestId,
        requestId,
        responseData: data,
        error,
        metadata,
      }) as RedditApiResponseEvent;

      await producer.send(DOMAIN, `reddit.api-call.${requestId}.${lifecycle}`, event);

      ctx.log.info(
        {
          requestId,
          lifecycle,
          handlerId: (metadata as { handlerId?: string } | undefined)?.handlerId,
          hasData: !!data,
          error: error?.message,
        },
        `Published ${lifecycle} response`,
      );
    });
  }

  async function processRequest(
    event: RedditApiRequestEvent,
    retryCount: number,
  ): Promise<void> {
    return tracer.with('Process Reddit API request', async (ctx) => {
      const { requestId, type, params } = event.data;

      ctx.annotate('request.id', requestId);
      ctx.annotate('request.type', type);
      ctx.annotate('retry.count', retryCount);

      try {
        let responseData: unknown;

        switch (type) {
          case 'fetch-subreddit-threads': {
            const threadParams = params as { subreddit: string; limit?: number };
            const threads = await redditClient.fetchSubredditThreads(
              threadParams.subreddit,
              threadParams.limit || 25,
            );
            responseData = threads;
            break;
          }
          case 'fetch-thread-replies': {
            const replyParams = params as { threadRedditId: string; subreddit: string };
            const replies = await redditClient.fetchThreadReplies(
              replyParams.threadRedditId,
              replyParams.subreddit,
            );
            responseData = replies;
            break;
          }
          case 'fetch-subreddit-about': {
            const aboutParams = params as { subreddit: string };
            const about = await redditClient.fetchSubredditAbout(aboutParams.subreddit);
            responseData = about;
            break;
          }
          default: {
            throw new Error(`Unknown request type: ${type}`);
          }
        }

        await publishResponse(
          requestId,
          true,
          responseData,
          undefined,
          event.data.metadata,
        );
        ctx.log.info(
          {
            requestId,
            type,
            handlerId: (event.data.metadata as { handlerId?: string } | undefined)
              ?.handlerId,
            responseDataSize: Array.isArray(responseData)
              ? responseData.length
              : responseData
                ? 1
                : 0,
          },
          'Request processed successfully',
        );
      } catch (error: any) {
        // Check if it's a RedditApiError with 429 status
        const isRateLimit =
          (error.name === 'RedditApiError' && error.status === 429) ||
          error.message?.includes('429');

        if (isRateLimit) {
          if (retryCount >= maxRetries) {
            ctx.log.error(
              { requestId, retryCount, error },
              'Max retries reached, publishing failed response',
            );
            await publishResponse(
              requestId,
              false,
              undefined,
              {
                message: error.message || 'Rate limit exceeded',
                code: 'RATE_LIMIT_EXCEEDED',
                retryCount,
              },
              event.data.metadata,
            );
            return;
          }

          // Extract response from error if available (RedditApiError)
          const response = error.response || ({} as Response);

          // Calculate retry delay
          const rateLimitInfo = calculateRetryDelay({
            response,
            retryCount,
            logger: ctx.log,
          });

          ctx.log.info(
            {
              requestId,
              retryCount,
              delayMs: rateLimitInfo.delayMs,
            },
            'Rate limit hit, scheduling retry',
          );

          try {
            await publishRetry(event, rateLimitInfo.delayMs, retryCount + 1);
          } catch (retryError: any) {
            ctx.log.error(
              {
                error: retryError,
                requestId,
                retryCount,
                delayMs: rateLimitInfo.delayMs,
                errorMessage: retryError?.message,
              },
              'Failed to publish retry request - delayed message plugin may not be enabled',
            );
            // Fall back to publishing failed response since we can't retry
            await publishResponse(requestId, false, undefined, {
              message: retryError?.message || 'Failed to schedule retry',
              code: 'RETRY_PUBLISH_FAILED',
              retryCount,
            });
          }
        } else {
          // Non-rate-limit error - publish failed response
          ctx.log.error({ requestId, error }, 'Request failed with non-rate-limit error');
          await publishResponse(
            requestId,
            false,
            undefined,
            {
              message: error.message || 'Unknown error',
              code: 'REQUEST_FAILED',
              retryCount,
            },
            event.data.metadata,
          );
        }
      }
    });
  }

  async function connect(): Promise<void> {
    return tracer.with('Connect Reddit API worker', async (ctx) => {
      connection = await connectToBroker(broker, boundLogger);

      // Set up request queue consumer
      const { channel, queue } = await initializeChannel(
        connection,
        DOMAIN,
        'api-call-requests',
        'reddit.api-call.requested',
        boundLogger,
      );

      requestChannel = channel;
      await requestChannel.prefetch(5);

      // Set up retry exchange (this will fail if plugin isn't enabled)
      try {
        await setupRetryExchange();
      } catch (error: any) {
        ctx.log.error(
          {
            error,
            errorMessage: error?.message,
          },
          'Failed to set up retry exchange - worker will continue but retries may fail',
        );
        // Don't throw - allow worker to start, but retries will fail
      }

      // Start consuming requests
      const consumeResult = await requestChannel.consume(
        queue,
        async (msg) => {
          if (!msg) return;

          const headers = msg.properties.headers || {};
          const content = JSON.parse(msg.content.toString()) as RedditApiRequestEvent;
          const retryCount = Number.parseInt(headers['x-retry-count'] || '0', 10) || 0;

          // Extract trace context from headers and continue the trace
          await tracer.with(
            `Consume Reddit API request ${content.data.requestId}`,
            {
              headers,
              attributes: {
                'messaging.system': 'rabbitmq',
                'messaging.domain': DOMAIN,
                'messaging.destination': queue,
                'messaging.destination_kind': 'queue',
                'messaging.message_id': msg.properties.messageId,
                'messaging.routing_key': 'reddit.api-call.requested',
                'request.id': content.data.requestId,
                'request.type': content.data.type,
                'retry.count': retryCount,
              },
            },
            async (requestCtx) => {
              requestCtx.log.info(
                {
                  requestId: content.data.requestId,
                  type: content.data.type,
                  retryCount,
                  messageId: msg.properties.messageId,
                },
                'Consumed Reddit API request',
              );

              try {
                await processRequest(content, retryCount);
                requestChannel?.ack(msg);
                requestCtx.log.debug(
                  { requestId: content.data.requestId },
                  'Acknowledged request message',
                );
              } catch (error) {
                requestCtx.log.error(
                  {
                    error,
                    requestId: content.data.requestId,
                    type: content.data.type,
                    retryCount,
                  },
                  'Error processing request message',
                );
                requestChannel?.nack(msg, false, true);
              }
            },
          );
        },
        { noAck: false },
      );

      consumerTag = consumeResult.consumerTag;

      ctx.log.info({ queue, consumerTag }, 'Reddit API worker connected and consuming');
    });
  }

  async function disconnect(): Promise<void> {
    if (requestChannel && consumerTag) {
      await requestChannel.cancel(consumerTag);
      await safeClose(requestChannel, 'request.channel', boundLogger);
      requestChannel = null;
      consumerTag = null;
    }
    if (retryChannel) {
      await safeClose(retryChannel, 'retry.channel', boundLogger);
      retryChannel = null;
    }
    if (retryConnection) {
      await safeClose(retryConnection, 'retry.connection', boundLogger);
      retryConnection = null;
    }
    if (connection) {
      await safeClose(connection, 'worker.connection', boundLogger);
      connection = null;
    }
  }

  return {
    connect,
    disconnect,
  };
}
