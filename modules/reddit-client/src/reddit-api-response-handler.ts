import type { Message } from '@modules/events';
import type { Logger } from '@modules/logger';
import type { Context, Tracer } from '@modules/tracing';
import type { RedditApiResponseEvent } from './reddit-api-types';

export type RedditApiResponseHandler<T = unknown> = (
  message: Message<RedditApiResponseEvent>,
  context: Context,
) => Promise<T>;

export interface RedditApiResponseHandlerRegistry {
  register<T = unknown>(handlerId: string, handler: RedditApiResponseHandler<T>): void;
  unregister(handlerId: string): void;
  handle(message: Message<RedditApiResponseEvent>, context: Context): Promise<void>;
}

export interface MakeRedditApiResponseHandlerRegistryOpts {
  logger: Logger;
  tracer?: Tracer; // Optional, only used for logging registration
}

export function makeRedditApiResponseHandlerRegistry(
  opts: MakeRedditApiResponseHandlerRegistryOpts,
): RedditApiResponseHandlerRegistry {
  const { logger } = opts;
  const handlers = new Map<string, RedditApiResponseHandler>();

  return {
    register<T = unknown>(handlerId: string, handler: RedditApiResponseHandler<T>): void {
      handlers.set(handlerId, handler as RedditApiResponseHandler);
      logger.info(
        { handlerId, registeredHandlers: Array.from(handlers.keys()) },
        'Registered Reddit API response handler',
      );
    },

    unregister(handlerId: string): void {
      handlers.delete(handlerId);
      logger.info(
        { handlerId, registeredHandlers: Array.from(handlers.keys()) },
        'Unregistered Reddit API response handler',
      );
    },

    async handle(
      message: Message<RedditApiResponseEvent>,
      context: Context,
    ): Promise<void> {
      return context.with('Route Reddit API response', async (ctx) => {
        const { requestId, error, metadata } = message.payload.data;
        const responseType = message.payload.type;
        const handlerId = (metadata as { handlerId?: string } | undefined)?.handlerId;
        const registeredHandlers = Array.from(handlers.keys());

        ctx.annotate('response.requestId', requestId);
        ctx.annotate('response.type', responseType);
        ctx.annotate('response.hasError', !!error);
        ctx.annotate('response.handlerId', handlerId || 'none');

        if (!handlerId) {
          ctx.log.warn(
            {
              requestId,
              responseType,
              metadata,
              registeredHandlers,
            },
            'Received API response without handlerId metadata, ignoring',
          );
          return;
        }

        const handler = handlers.get(handlerId);
        if (!handler) {
          // This is expected when multiple apps consume from the same queue
          // The message was distributed to an app that doesn't have this handler
          // The handler exists in another app and will process the message there
          ctx.log.debug(
            {
              requestId,
              handlerId,
              responseType,
              metadata,
              registeredHandlers,
              registeredCount: registeredHandlers.length,
            },
            'No handler found for handlerId in this app - message may be processed by another app',
          );
          return;
        }

        ctx.log.debug(
          { requestId, handlerId, responseType },
          'Routing response to handler',
        );

        await handler(message, context);
      });
    },
  };
}
