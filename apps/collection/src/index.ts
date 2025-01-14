import Env from '@/env';
import { makeConsumer, makeProducer } from '@modules/events';
import { makeLogger } from '@modules/logger';

import { makeMigrateDB } from '@modules/db';
import { makeTracer } from '@modules/tracing';
import { makeOnCollectionCreatedService } from './collection/collection.created.service';
import { makeDB } from './db';

const logger = makeLogger({
  name: 'collection',
});
const tracer = makeTracer({
  serviceName: 'collection',
  exporterUrl: Env.TRACE_EXPORTER_URL,
  logger,
});

const migrate = makeMigrateDB({
  url: Env.DATABASE_URL,
  tracer,
});

await migrate();

const db = makeDB({
  url: Env.DATABASE_URL,
  logger,
});

const producer = makeProducer({ broker: Env.BROKER_URL, logger, tracing: { tracer } });
await producer.connect();

const consumers = makeConsumer({
  broker: Env.BROKER_URL,
  logger,
  tracing: { tracer },
  handlers: [
    {
      domain: 'collection',
      queue: 'collection.created',
      // TODO need to type messages now
      onMessage: makeOnCollectionCreatedService({ db, producer }).onCollectionCreated,
    },
  ],
});

logger.info('Setting up...');
await consumers.connect();

logger.info('Starting...');
