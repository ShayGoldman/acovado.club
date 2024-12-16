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

  await tracer.with(
    `Running simulation`,
    {
      attributes: inputs,
    },
    async (c) => {
      c.log.info('Starting simulation...');
      // Fetch signals based on filters
      const signals = await c.with('Fetching signals', () =>
        db
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
          .orderBy(asc(schema.signalMetrics.createdAt)),
      );

      if (signals.length === 0) {
        c.log.warn('No signals found for the given criteria.');
        return;
      }

      c.log.info(`Found ${signals.length} signals`);

      // Publish signals to RabbitMQ
      await c.with('Emitting signals in order', async (c2) => {
        for (const { signal_metrics: signal } of signals) {
          c2.log.debug(`Publishing signal: ${signal.id}`);

          const event = makeEvent('signal', 'created', signal);
          producer.send('signal', event.type, event);

          if (inputs.delay > 0) {
            c2.log.debug(`Delaying next event by ${inputs.delay}ms`);
            await new Promise((resolve) => setTimeout(resolve, inputs.delay));
          }
        }
      });

      c.log.info('Simulation completed. Shutting down...');
    },
  );

  // TODO wait until all events are consumed properly
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
