import { trace, context } from '@opentelemetry/api';
import amqp from 'amqplib';
import type { Logger } from '@modules/logger';
import { makeMessageId } from '@modules/ids';
import type { MessageMetadata } from './types';

export async function connectToBroker(
  broker: string,
  logger: Logger,
): Promise<amqp.Connection> {
  try {
    const connection = await amqp.connect(broker);
    logger.info({ event: 'rabbitmq.connected' }, 'Connected to RabbitMQ');
    return connection;
  } catch (error) {
    logger.error(
      { event: 'rabbitmq.connection_error', error },
      'Failed to connect to RabbitMQ',
    );
    throw error;
  }
}

export async function safeClose(
  resource: { close: () => Promise<void> },
  name: string,
  logger: Logger,
) {
  try {
    await resource.close();
    logger.info({ event: `${name}.closed` }, `${name} closed successfully`);
  } catch (error) {
    logger.error({ event: `${name}.close_error`, error }, `Error while closing ${name}`);
  }
}

export async function initializeChannel(
  connection: amqp.Connection,
  domain: string,
  queue: string,
  routingKey: string,
  logger: Logger,
): Promise<{ channel: amqp.Channel; queue: string; exchange: string }> {
  const channel = await connection.createChannel();
  logger.info(
    { event: 'channel.created', queue },
    `Channel created for queue "${queue}"`,
  );

  const exchange = `${domain}.exchange`;
  const queueName = `${domain}.${queue}`;

  await channel.assertExchange(exchange, 'topic', { durable: true });
  await channel.assertQueue(queueName, { durable: true });
  await channel.bindQueue(queueName, exchange, routingKey);

  logger.info(
    { event: 'queue.bound', exchange, queue: queueName, routingKey },
    `Queue "${queueName}" bound to exchange "${exchange}" with routing key "${routingKey}"`,
  );

  return { channel, queue: queueName, exchange };
}

export function makeMessageMetadata(
  domain: string,
  queue: string,
  routingKey: string,
  messageId = makeMessageId(),
  headers: Record<string, string> = {},
): MessageMetadata {
  return {
    messageId,
    correlationId: getCorrelationIdFromTrace() || '',
    domain,
    queue,
    routingKey,
    timestamp: new Date().toISOString(),
    headers,
    version: '1.0.0',
  };
}

export function makeBoundLogger(
  logger: Logger,
  context: {
    domain?: string;
    topic?: string;
    routingKey?: string;
    messageId?: string;
  } = {},
): Logger {
  const correlationId = getCorrelationIdFromTrace();
  const extendedBindings = {
    ...(correlationId && { traceId: correlationId }),
    ...(context.domain && { domain: context.domain }),
    ...(context.topic && { topic: context.topic }),
    ...(context.routingKey && { routingKey: context.routingKey }),
    ...(context.messageId && { messageId: context.messageId }),
  };

  return logger.child(extendedBindings);
}

/**
 * Generates a correlationId based on the current OpenTelemetry trace context.
 * @returns The traceId from the current OpenTelemetry context or undefined if no trace is found.
 */
export function getCorrelationIdFromTrace(): string | undefined {
  const activeSpan = trace.getSpan(context.active());
  if (!activeSpan) return undefined;

  const spanContext = activeSpan.spanContext();
  if (!spanContext.traceId) return undefined;

  return spanContext.traceId;
}
