import { parseEnv } from '@/env';
import { makeDBClient, makeMigrateDB } from '@modules/db';
import { makeConsumer } from '@modules/events';
import { makeInferenceClient } from '@modules/inference';
import { makeLogger } from '@modules/logger';
import { makeTickerExtractor } from '@modules/ticker-extractor';
import { makeTracer } from '@modules/tracing';
import { makeMessageHandler } from './handler';
import { makeYouTubeMessageHandler } from './youtube-handler';

const Env = parseEnv(process.env);

const logger = makeLogger({ name: 'signal-processor' });
const tracer = makeTracer({
  serviceName: 'signal-processor',
  exporterUrls: Env.TRACE_EXPORTER_URLS,
  deploymentEnvironment: Env.NODE_ENV,
  logger,
});

const db = makeDBClient({ url: Env.DATABASE_URL, tracer });
const inferenceClient = makeInferenceClient({ db, tracer });
const tickerExtractor = makeTickerExtractor({
  inferenceClient,
  ollamaBaseUrl: Env.OLLAMA_BASE_URL,
  model: Env.OLLAMA_MODEL,
});

await makeMigrateDB({ url: Env.DATABASE_URL, tracer })();

const onRedditMessage = makeMessageHandler({ db, tickerExtractor, tracer });
const onYouTubeMessage = makeYouTubeMessageHandler({ db, tickerExtractor, tracer });

const consumer = makeConsumer({
  broker: Env.RABBITMQ_URL,
  logger,
  tracing: { tracer },
  prefetch: 5,
  handlers: [
    {
      domain: 'reddit',
      queue: 'signal-processor',
      routingKey: 'post.collected',
      onMessage: onRedditMessage,
    },
    {
      domain: 'youtube',
      queue: 'signal-processor',
      routingKey: 'video.collected',
      onMessage: onYouTubeMessage,
    },
  ],
});

await consumer.connect();
logger.info(
  'signal-processor: consuming from reddit:signal-processor + youtube:signal-processor',
);

const server = Bun.serve({
  port: Env.PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', service: 'signal-processor' });
    }
    return new Response('Not found', { status: 404 });
  },
});
logger.info({ port: server.port }, 'signal-processor: health server listening');

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'signal-processor: shutting down');
  server.stop();
  await consumer.disconnect();
  await tracer.shutdown();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
