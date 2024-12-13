import { asc, and, eq, gte, inArray, lte, schema } from '@modules/db';
import { makeEvent, makeProducer } from '@modules/events'; // Assuming events is the RabbitMQ client or abstraction
import { makeLogger } from '@modules/logger';
import { makeTracer } from '@modules/tracing';
import type { Config } from './config';
import { makeDB } from './db';

export async function runSimulation(
  inputs: {
    tickers: string[];
    start: string;
    end: string;
    type: string;
    delay: number;
  },
  config: Config,
) {
  const logger = makeLogger({ name: 'simulation' });

  logger.info('Intializing simulation...');
  const db = makeDB({
    url: config.DATABASE_URL,
    logger,
  });
  const tracer = makeTracer({
    logger,
    serviceName: 'simulation',
    exporterUrl: config.TRACE_EXPORTER_URL,
  });
  const producer = makeProducer({
    broker: config.BROKER_URL,
    logger,
    tracing: { tracer },
  });

  await producer.connect();

  // Fetch signals based on filters
  const signals = await db
    .select()
    .from(schema.signalMetrics)
    .innerJoin(schema.tickers, eq(schema.signalMetrics.tickerId, schema.tickers.id))
    .where(({ signal_metrics }) => {
      const conditions = [];
      if (inputs.start)
        conditions.push(gte(signal_metrics.createdAt, new Date(inputs.start)));
      if (inputs.end)
        conditions.push(lte(signal_metrics.createdAt, new Date(inputs.end)));
      if (inputs.type) conditions.push(eq(signal_metrics.type, inputs.type));
      if (inputs.tickers.length > 0)
        conditions.push(inArray(schema.tickers.symbol, inputs.tickers));
      return and(...conditions);
    })
    .orderBy(asc(schema.signalMetrics.createdAt));

  if (signals.length === 0) {
    logger.warn('No signals found for the given criteria.');
    return;
  }

  logger.info(`Found ${signals.length} signals`);
  logger.info('Starting simulation...');

  // Publish signals to RabbitMQ
  for (const { signal_metrics: signal } of signals) {
    logger.debug(`Publishing signal: ${signal.id}`);

    const event = makeEvent('signal', 'created', signal);
    producer.send('signal', event.type, event);

    if (inputs.delay > 0) {
      logger.debug(`Delaying next event by ${inputs.delay}ms`);
      await new Promise((resolve) => setTimeout(resolve, inputs.delay));
    }
  }

  logger.info('Simulation completed.');
}
