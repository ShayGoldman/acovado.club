import Env from '@/env';
import { makeProducer } from '@modules/events';
import { makeLogger } from '@modules/logger';

import { makeMigrateDB } from '@modules/db';
import { makeTracer } from '@modules/tracing';
import { makeDB } from './db';
import { makeCronJobsService } from './entry-points/crons';

const logger = makeLogger({
  name: 'bebe',
});
const tracer = makeTracer({
  serviceName: 'bebe',
  exporterUrl: Env.TRACE_EXPORTER_URL,
  logger,
});

const migrate = makeMigrateDB({
  url: Env.DATABASE_URL,
  tracer,
});

await migrate();
const producer = makeProducer({
  broker: Env.BROKER_URL,
  logger,
  tracing: { tracer },
});
const db = makeDB({
  url: Env.DATABASE_URL,
  logger,
});

logger.info('Setting up...');
await producer.connect();

const crons = await makeCronJobsService({
  db,
  tracer,
  producer,
  env: Env,
});

await crons.start();
