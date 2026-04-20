import { parseEnv } from '@/env';
import { makeDBClient, makeMigrateDB } from '@modules/db';
import { makeProducer } from '@modules/events';
import { makeLogger } from '@modules/logger';
import { makeTracer } from '@modules/tracing';
import pkg from '../package.json' with { type: 'json' };
import { makeCronRunner } from './cron';
import { makePoller } from './poller';
import { makeYouTubeClient } from './youtube-client';

const Env = parseEnv(process.env);

const logger = makeLogger({ name: 'youtube-worker' });
const tracer = makeTracer({
  serviceName: 'youtube-worker',
  exporterUrls: Env.TRACE_EXPORTER_URLS,
  deploymentEnvironment: Env.NODE_ENV,
  logger,
});

const db = makeDBClient({ url: Env.DATABASE_URL, tracer });
const producer = makeProducer({ broker: Env.RABBITMQ_URL, logger, tracing: { tracer } });
const youtubeClient = makeYouTubeClient({ logger });

const poller = makePoller({
  db,
  producer,
  youtubeClient,
  logger,
  tracer,
  fetchLimit: Env.YOUTUBE_FETCH_LIMIT,
});

const cron = makeCronRunner({
  expression: Env.POLL_CRON,
  logger,
  onTick: () => poller.runOnce(),
});

await makeMigrateDB({ url: Env.DATABASE_URL, tracer })();
await producer.connect();

logger.info(
  { version: pkg.version, commit: Bun.env['COMMIT_SHA'] ?? 'unknown' },
  'starting worker',
);

cron.start();

// Eager first tick — avoids a cold-start wait on first deploy.
void poller
  .runOnce()
  .catch((err) => logger.error({ err }, 'youtube-worker: initial tick error'));

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'youtube-worker: shutting down');
  cron.stop();
  await producer.disconnect();
  await tracer.shutdown();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
