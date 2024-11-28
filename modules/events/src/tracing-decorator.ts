import type { Logger } from '@modules/logger';
import type { Context } from '@modules/tracing';
import { injectTraceContext, type Tracer } from '@modules/tracing';
import type { Message } from './types';

function makeNoopContext(log: Logger): Context {
  const withFn = <T>(
    name: string,
    optsOrFn: any,
    maybeFn?: (context: Context) => Promise<T>,
  ): Promise<T> => {
    const fn: (context: Context) => Promise<T> =
      typeof optsOrFn === 'function' ? optsOrFn : maybeFn!;
    return fn(noopContext);
  };

  const annotate = (key: string, value: string | number | boolean): void => {
    // TODO can cause duplicate keys
    log.setBindings({ [key]: value });
  };

  const setName = (name: string) => {
    // Noop
  };

  const noopContext: Context = {
    log,
    with: withFn,
    annotate,
    setName,
  };

  return noopContext;
}

export interface MakeTracingDecoratorOpts {
  tracer?: Tracer;
  logger: Logger;
}

export function makeTracingDecorator(opts: MakeTracingDecoratorOpts) {
  const { logger, tracer } = opts;
  /**
   * Decorates a consumer message handler with tracing spans.
   */
  function decorateHandler<T>(
    handler: (message: Message<T>, context: Context) => Promise<void>,
    options: {
      domain: string;
      queue: string;
      routingKey: string;
    },
  ): (message: Message<T>) => Promise<void> {
    if (!tracer) {
      // Tracer is not enabled, return the original handler with default context
      return async (message: Message<T>) => {
        const context = makeNoopContext(logger!);
        await handler(message, context);
      };
    }

    return async (message: Message<T>) => {
      const { domain, queue, routingKey } = options;
      const messageId = message.metadata.messageId;
      const headers = message.metadata.headers;

      return tracer.with(
        `${queue}: Consumed ${message.metadata.messageId}`,
        {
          headers,
          attributes: {
            'messaging.system': 'rabbitmq',
            'messaging.domain': domain,
            'messaging.destination': queue,
            'messaging.destination_kind': 'queue',
            'messaging.message_id': messageId,
            'messaging.routing_key': routingKey,
          },
        },
        async (context) => {
          try {
            await handler(message, context);
          } catch (error: any) {
            context.log.error('Error processing message', { error: error.message });
            throw error;
          }
        },
      );
    };
  }

  /**
   * Decorates a producer `send` operation with tracing spans.
   */
  function decorateProducer<T>(
    send: (
      domain: string,
      routingKey: '#' | string,
      messages: T | T[],
      headers?: any,
    ) => Promise<void>,
  ): (
    domain: string,
    routingKey: string,
    messages: T | T[],
    headers?: any,
  ) => Promise<void> {
    if (!tracer) {
      // Tracer is not enabled, return the original send function
      return send;
    }

    return async (domain, routingKey, messages, headers = {}) => {
      const tracedHeaders = injectTraceContext(headers);
      return tracer.with(
        `Publish Message to ${domain}.${routingKey}`,
        {
          attach: true,
          attributes: {
            'messaging.system': 'rabbitmq',
            'messaging.destination': `${domain}.exchange`,
            'messaging.destination_kind': 'exchange',
            'messaging.routing_key': routingKey,
          },
        },
        async (context) => {
          try {
            await send(domain, routingKey, messages, tracedHeaders);
          } catch (error: any) {
            context.log.error('Error publishing message', { error: error.message });
            throw error;
          }
        },
      );
    };
  }

  return {
    decorateHandler,
    decorateProducer,
  };
}
