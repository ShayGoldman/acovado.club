import { parseEnv } from '@/env';
import { makeDBClient, makeMigrateDB } from '@modules/db';
import { makeConsumer } from '@modules/events';
import { makeClaudeProvider, makeInferenceClient } from '@modules/inference';
import { makeLogger } from '@modules/logger';
import { makeTickerExtractor } from '@modules/ticker-extractor';
import { makeTracer } from '@modules/tracing';
import pkg from '../package.json' with { type: 'json' };
import { makeMessageHandler } from './handler';
import { makeNewsArticleHandler } from './news-handler';
import { makeYouTubeMessageHandler } from './youtube-handler';

const VERSION = pkg.version;
const COMMIT = Bun.env['COMMIT_SHA'] ?? 'unknown';

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
const claudeProvider = makeClaudeProvider({ apiKey: Env.ANTHROPIC_API_KEY });
const tickerExtractor = makeTickerExtractor({
  inferenceClient,
  provider: claudeProvider,
});

await makeMigrateDB({ url: Env.DATABASE_URL, tracer })();

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
      onMessage: makeMessageHandler({ db, tickerExtractor, tracer }),
    },
    {
      domain: 'youtube',
      queue: 'signal-processor',
      routingKey: 'video.collected',
      onMessage: makeYouTubeMessageHandler({ db, tickerExtractor, tracer }),
    },
    {
      domain: 'news',
      queue: 'signal-processor',
      routingKey: 'article.collected',
      onMessage: makeNewsArticleHandler({ db, tickerExtractor, tracer }),
    },
  ],
});

await consumer.connect();
logger.info(
  'signal-processor: consuming from reddit:signal-processor + youtube:signal-processor + news:signal-processor',
);

const server = Bun.serve({
  port: Env.PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/health') {
      return Response.json({
        status: 'ok',
        service: 'signal-processor',
        version: VERSION,
        commit: COMMIT,
      });
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
