import Env from '@/env';
import { makeProducer } from '@modules/events';
import { makeRedditApiQueueWorker } from './worker';
import { makeLogger } from '@modules/logger';
import { makeTracer } from '@modules/tracing';

const logger = makeLogger({
  name: 'reddit-api-worker',
});

const tracer = makeTracer({
  serviceName: 'reddit-api-worker',
  exporterUrls: Env.TRACE_EXPORTER_URLS,
  logger,
});

const producer = makeProducer({
  broker: Env.BROKER_URL,
  logger,
  tracing: { tracer },
});

logger.info('Setting up Reddit API worker...');
await producer.connect();

const worker = makeRedditApiQueueWorker({
  broker: Env.BROKER_URL,
  logger,
  tracer,
  producer,
  ...(Env.MAX_RETRIES !== undefined && { maxRetries: Env.MAX_RETRIES }),
});

await worker.connect();

logger.info('Reddit API worker is running');

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  await worker.disconnect();
  await producer.disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  await worker.disconnect();
  await producer.disconnect();
  process.exit(0);
});
