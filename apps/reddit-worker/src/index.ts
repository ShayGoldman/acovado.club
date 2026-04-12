import { makeDBClient, makeMigrateDB } from '@modules/db';
import { makeProducer } from '@modules/events';
import { makeLogger } from '@modules/logger';
import { makeTracer } from '@modules/tracing';
import { makeCronRunner } from './cron';
import { parseEnv } from './env';
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

await makeMigrateDB({ url: Env.DATABASE_URL, tracer })();
await producer.connect();

const poller = makePoller({
  db,
  producer,
  logger,
  tracer,
  fetchLimit: Env.REDDIT_FETCH_LIMIT,
});
const cron = makeCronRunner({
  cronExpression: Env.POLL_CRON,
  logger,
  onTick: () => poller.runOnce(),
});

cron.start();

// Eager first tick — run immediately on startup to avoid 2-hour cold-start window
void poller.runOnce().catch((err) => logger.error({ err }, 'initial tick error'));

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'reddit-worker: shutting down');
  cron.stop();
  await producer.disconnect();
  await tracer.shutdown();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
