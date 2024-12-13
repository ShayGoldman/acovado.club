import Env from '@/env';
import { makeConsumer, makeProducer } from '@modules/events';
import { makeLogger } from '@modules/logger';

import { makeMigrateDB } from '@modules/db';
import { makeTracer } from '@modules/tracing';
import { makeDB } from './db';
import { makeOnSignalCreatedService } from './signaling/signal-created.service';

const logger = makeLogger({
  name: 'ana-liese',
});

const migrate = makeMigrateDB({
  url: Env.DATABASE_URL,
  logger,
});

await migrate();
const tracer = makeTracer({
  serviceName: 'ana-liese',
  exporterUrl: Env.TRACE_EXPORTER_URL,
  logger,
});

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
      domain: 'signal',
      queue: 'signal.created',
      // TODO need to type messages now
      onMessage: makeOnSignalCreatedService({ db }).onSignalCreated,
    },
  ],
});

logger.info('Setting up...');
await consumers.connect();

logger.info('Starting...');
