import Env from '@/env';
import { makeThreadHandlerService } from '@/processing/thread-handler.service';
import { makeDBClient, makeMigrateDB } from '@modules/db';
import { makeConsumer } from '@modules/events';
import { makeLogger } from '@modules/logger';
import { makeTracer } from '@modules/tracing';

const logger = makeLogger({
  name: 'reddit-processor',
});

const tracer = makeTracer({
  serviceName: 'reddit-processor',
  exporterUrls: Env.TRACE_EXPORTER_URLS,
  logger,
});

const migrate = makeMigrateDB({
  url: Env.DATABASE_URL,
  tracer,
});

await migrate();

const db = makeDBClient({
  url: Env.DATABASE_URL,
  tracer,
});

const threadHandler = makeThreadHandlerService({ db });

const consumer = makeConsumer({
  broker: Env.BROKER_URL,
  logger,
  tracing: { tracer },
  handlers: [
    {
      domain: 'reddit',
      queue: 'reddit.thread.fetched',
      routingKey: 'reddit.thread.fetched',
      onMessage: threadHandler.onThreadFetched,
    },
  ],
});

logger.info('Setting up...');
await consumer.connect();

logger.info('Reddit processor is running');
