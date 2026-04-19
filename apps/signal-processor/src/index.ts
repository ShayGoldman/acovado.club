import { parseEnv } from '@/env';
import { makeMigrateDB } from '@modules/db';
import { makeConsumer } from '@modules/events';
import { makeLogger } from '@modules/logger';
import { makeTracer } from '@modules/tracing';

const Env = parseEnv(process.env);

const logger = makeLogger({ name: 'signal-processor' });
const tracer = makeTracer({
  serviceName: 'signal-processor',
  exporterUrls: Env.TRACE_EXPORTER_URLS,
  deploymentEnvironment: Env.NODE_ENV,
  logger,
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
      onMessage: async () => {},
    },
    {
      domain: 'youtube',
      queue: 'signal-processor',
      routingKey: 'video.collected',
      onMessage: async () => {},
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
