import Env from '@/env';
import { makeTickerExtractorService } from '@/inference/ticker-extractor.service';
import { makeThreadHandlerService } from '@/processing/thread-handler.service';
import { makeDBClient, makeMigrateDB } from '@modules/db';
import { makeConsumer } from '@modules/events';
import { makeGraphClient } from '@modules/graph-db';
import { makeLogger } from '@modules/logger';
import { makeTracer } from '@modules/tracing';

const logger = makeLogger({
  name: 'reddit-processor',
  level: 'debug',
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

const graphClient = makeGraphClient({
  url: Env.GRAPH_DB_URL,
  tracer,
});

logger.info('Setting up...');
await graphClient.connect();

const tickerExtractor = makeTickerExtractorService({
  ollamaBaseUrl: Env.OLLAMA_BASE_URL,
});

const threadHandler = makeThreadHandlerService({
  db,
  graphClient,
  tracer,
  tickerExtractor,
});

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

await consumer.connect();

logger.info('Reddit processor is running');
