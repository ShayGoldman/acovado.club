// consumer.ts

import {
  connectToBroker,
  safeClose,
  initializeChannel,
  makeMessageMetadata,
  makeBoundLogger,
} from './utils';
import amqp from 'amqplib';
import type { Logger } from '@modules/logger';
import type { Message } from './types';
import type { KebabCase } from 'type-fest';
import type { Context, Tracer } from '@modules/tracing'; // Use custom Tracer
import { makeTracingDecorator } from './tracing-decorator';

export interface EventHandler {
  domain: string;
  queue: KebabCase<string>;
  routingKey?: string; // Defaults to `#` if not provided
  onMessage: <T>(message: Message<T>, context: Context) => Promise<void>;
}

export interface MakeEventsConsumerOpts {
  broker: string;
  logger: Logger;
  handlers: EventHandler | EventHandler[]; // Support single or multiple handlers
  tracing?: {
    tracer: Tracer;
  };
}

export function makeConsumer({
  broker,
  logger,
  handlers,
  tracing,
}: MakeEventsConsumerOpts) {
  let connection: amqp.Connection | null = null;
  const handlerList = Array.isArray(handlers) ? handlers : [handlers];
  const channels: Map<string, amqp.Channel> = new Map();
  const boundLogger = makeBoundLogger(logger);

  const tracingDecorator = makeTracingDecorator({
    logger: boundLogger,
    tracer: tracing?.tracer,
  });

  async function connect(): Promise<void> {
    connection = await connectToBroker(broker, boundLogger);

    for (const handler of handlerList) {
      const channel = await initializeChannel(
        connection,
        handler.domain,
        handler.queue,
        handler.routingKey || '#',
        boundLogger,
      );
      channels.set(handler.queue, channel);

      const decoratedHandler = tracingDecorator.decorateHandler(handler.onMessage, {
        domain: handler.domain,
        queue: handler.queue,
        routingKey: handler.routingKey || '#',
      });

      channel.consume(
        handler.queue,
        async (msg) => {
          if (!msg) return;

          const content = JSON.parse(msg.content.toString());
          const metadata = makeMessageMetadata(
            handler.domain,
            handler.queue,
            handler.routingKey || '#',
            msg.properties.messageId,
            msg.properties.headers,
          );

          const parsedMessage: Message<any> = {
            payload: content,
            metadata,
          };

          try {
            await decoratedHandler(parsedMessage);
            channel.ack(msg);
            boundLogger.info(
              { event: 'consumer.message_processed' },
              'Message processed successfully',
            );
          } catch (error) {
            channel.nack(msg, false, true);
            boundLogger.error(
              { event: 'consumer.message_error', error },
              'Error processing message',
            );
          }
        },
        { noAck: false },
      );
    }
  }

  async function disconnect(): Promise<void> {
    for (const channel of channels.values())
      await safeClose(channel, 'consumer.channel', boundLogger);
    if (connection) await safeClose(connection, 'consumer.connection', boundLogger);
    channels.clear();
  }

  return { connect, disconnect };
}
