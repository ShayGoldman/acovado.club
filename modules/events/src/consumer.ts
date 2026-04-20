// consumer.ts

import type { Logger } from '@modules/logger';
import type { Context, Tracer } from '@modules/tracing'; // Use custom Tracer
import type { Channel, Connection } from 'amqplib';
import type { KebabCase } from 'type-fest';
import { makeTracingDecorator } from './tracing-decorator';
import type { Message } from './types';
import {
  connectToBroker,
  initializeChannel,
  makeBoundLogger,
  makeMessageMetadata,
  safeClose,
} from './utils';

export interface EventHandler {
  domain: string;
  queue: KebabCase<string>;
  routingKey?: string; // Defaults to `#` if not provided
  onMessage: (message: Message<any>, context: Context) => Promise<void>;
}
//
export type Consumer = ReturnType<typeof makeConsumer>;

export interface MakeEventsConsumerOpts {
  broker: string;
  logger: Logger;
  handlers: EventHandler | EventHandler[]; // Support single or multiple handlers
  tracing?: {
    tracer: Tracer;
  };
  prefetch?: number;
}

export function makeConsumer({
  broker,
  logger,
  handlers,
  tracing,
  prefetch,
}: MakeEventsConsumerOpts) {
  let connection: Connection | null = null;
  const handlerList = Array.isArray(handlers) ? handlers : [handlers];
  const channels: Map<string, Channel> = new Map();
  const boundLogger = makeBoundLogger(logger);

  const tracingDecorator = makeTracingDecorator({
    logger: boundLogger,
    tracer: tracing?.tracer,
  });

  async function connect(): Promise<void> {
    connection = await connectToBroker(broker, boundLogger);

    for (const handler of handlerList) {
      const {
        channel,
        exchange: _exchange,
        queue,
      } = await initializeChannel(
        connection,
        handler.domain,
        handler.queue,
        handler.routingKey || '#',
        boundLogger,
      );
      channels.set(queue, channel);

      await channel.prefetch(prefetch || 1);

      const decoratedHandler = tracingDecorator.decorateHandler(handler.onMessage, {
        domain: handler.domain,
        queue,
        routingKey: handler.routingKey || '#',
      });

      channel.consume(
        queue,
        async (msg) => {
          if (!msg) return;

          const content = JSON.parse(msg.content.toString());
          const metadata = makeMessageMetadata(
            handler.domain,
            queue,
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
            boundLogger.debug('Message processed successfully');
          } catch (error) {
            channel.nack(msg, false, true);
            boundLogger.error(error, 'Error processing message');
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
