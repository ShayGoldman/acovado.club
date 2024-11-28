import Env from '@/env';
import { makeProducer, type BasePayload } from '@modules/events';
import { makeLogger } from '@modules/logger';

import { makeMigrateDB } from '@modules/db';
import { makeTracer } from '@modules/tracing';
import { makeDB } from './db';

const logger = makeLogger({
  name: 'bebe',
});

const migrate = makeMigrateDB({
  url: Env.DATABASE_URL,
  logger,
});

await migrate();
const tracer = makeTracer({
  serviceName: 'bebe',
  exporterUrl: Env.TRACE_EXPORTER_URL,
  logger,
});
const producer = makeProducer({
  broker: Env.BROKER_URL,
  logger,
  tracing: { tracer },
});
const db = makeDB({
  url: Env.DATABASE_URL,
});

logger.info('Setting up...');
await producer.connect();

logger.info('Starting...');

const tickers = await db.query.tickers.findMany();

for (const ticker of tickers) {
  tracer.with(`Collect ticker ${ticker.symbol}`, async (c) => {
    const event: BasePayload = {
      id: Math.random(),
      resource: 'collection-request',
      data: ticker,
      type: 'collection.requested',
      timestamp: new Date(),
    };
    producer.send('collection', 'collection.requested', event);
    c.log.info('Message sent');
  });
}
