import { parseEnv } from '@/env';
import { makeDBClient, makeMigrateDB } from '@modules/db';
import { makeProducer } from '@modules/events';
import { makeLogger } from '@modules/logger';
import { makeRedditClient } from '@modules/reddit-client';
import { makeTracer } from '@modules/tracing';
import pkg from '../package.json' with { type: 'json' };
import { makeCronRunner } from './cron';
import { makePoller } from './poller';

const Env = parseEnv(process.env);

const logger = makeLogger({ name: 'reddit-worker' });
const tracer = makeTracer({
  serviceName: 'reddit-worker',
  exporterUrls: Env.TRACE_EXPORTER_URLS,
  deploymentEnvironment: Env.NODE_ENV,
  logger,
});

const db = makeDBClient({ url: Env.DATABASE_URL, tracer });
const producer = makeProducer({ broker: Env.RABBITMQ_URL, logger, tracing: { tracer } });
const redditClient = makeRedditClient({ logger });

const poller = makePoller({
  db,
  producer,
  redditClient,
  logger,
  tracer,
  fetchLimit: Env.REDDIT_FETCH_LIMIT,
});

const cron = makeCronRunner({
  expression: Env.REDDIT_POLL_CRON,
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
  .catch((err) => logger.error({ err }, 'reddit-worker: initial tick error'));

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'reddit-worker: shutting down');
  cron.stop();
  await producer.disconnect();
  await tracer.shutdown();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
