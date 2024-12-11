// producer.ts

import {
  connectToBroker,
  safeClose,
  makeMessageMetadata,
  makeBoundLogger,
} from './utils';
import type { Logger } from '@modules/logger';
import amqp from 'amqplib';
import { type Tracer } from '@modules/tracing'; // Use custom Tracing
import { makeTracingDecorator } from './tracing-decorator';

interface MakeEventsProducerOpts {
  broker: string;
  logger: Logger;
  tracing?: {
    tracer: Tracer;
  };
}

interface SendMessageOpts {
  headers?: Record<string, string>;
  baggage?: Record<string, string>;
}

export function makeProducer({ broker, logger, tracing }: MakeEventsProducerOpts) {
  let connection: amqp.Connection | null = null;
  let channel: amqp.Channel | null = null;
  const boundLogger = makeBoundLogger(logger);

  const tracingDecorator = makeTracingDecorator({
    logger: boundLogger,
    tracer: tracing?.tracer,
  });

  async function connect(): Promise<void> {
    connection = await connectToBroker(broker, boundLogger);
    channel = await connection.createChannel();
    boundLogger.info({ event: 'producer.channel_created' }, 'Producer channel created');
  }

  async function sendMessage<T = Record<string, unknown>>(
    domain: string,
    routingKey: '#' | string,
    messages: T | T[],
    opts: SendMessageOpts = {},
  ) {
    const { headers = {} } = opts;
    if (!channel) {
      throw new Error('Producer is not connected. Call `connect()` first.');
    }

    const exchange = `${domain}.exchange`;
    await channel.assertExchange(exchange, 'topic', { durable: true });

    const msgs = Array.isArray(messages) ? messages : [messages];
    for (const msg of msgs) {
      const metadata = makeMessageMetadata(domain, '', routingKey);

      const messageHeaders = {
        ...headers,
        'x-version': metadata.version,
      };

      channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(msg)), {
        messageId: metadata.messageId,
        correlationId: metadata.correlationId,
        timestamp: Date.now(),
        headers: messageHeaders,
      });

      boundLogger.info(
        { event: 'producer.message_published', metadata },
        `Message sent to exchange "${exchange}" with routing key "${routingKey}"`,
      );
    }
  }

  async function disconnect(): Promise<void> {
    if (channel) await safeClose(channel, 'producer.channel', boundLogger);
    if (connection) await safeClose(connection, 'producer.connection', boundLogger);
    channel = null;
    connection = null;
  }

  const send = tracingDecorator.decorateProducer(sendMessage);

  return { connect, send, disconnect };
}
