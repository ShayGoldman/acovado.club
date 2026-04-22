import { parseEnv } from '@/env';
import { makeDBClient, makeMigrateDB } from '@modules/db';
import { makeProducer } from '@modules/events';
import { makeLogger } from '@modules/logger';
import { makeTracer } from '@modules/tracing';
import { type Browser, chromium } from 'playwright';
import pkg from '../package.json' with { type: 'json' };
import { makeArticleFetcher } from './article-fetcher';
import { makeCronRunner } from './cron';
import { makeDiscovery } from './discovery';

const VERSION = pkg.version;
const COMMIT = Bun.env['COMMIT_SHA'] ?? 'unknown';

const Env = parseEnv(process.env);

const logger = makeLogger({ name: 'news-worker' });
const tracer = makeTracer({
  serviceName: 'news-worker',
  exporterUrls: Env.TRACE_EXPORTER_URLS,
  deploymentEnvironment: Env.NODE_ENV,
  logger,
});

const db = makeDBClient({ url: Env.DATABASE_URL, tracer });
const producer = makeProducer({ broker: Env.RABBITMQ_URL, logger, tracing: { tracer } });

const browser: Browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox'],
});
logger.info(
  { playwrightBrowser: 'chromium', browserVersion: browser.version() },
  'chromium launched',
);

const discovery = makeDiscovery({ db, browser, logger, tracer });

const fetcher = makeArticleFetcher({
  db,
  browser,
  logger,
  tracer,
  producer,
  navTimeoutMs: Env.NEWS_NAV_TIMEOUT_MS,
  maxRetries: Env.NEWS_FETCH_MAX_RETRIES,
  concurrency: Env.NEWS_FETCH_CONCURRENCY,
  robotsCacheTtlMs: Env.NEWS_ROBOTS_CACHE_TTL_MS,
});

async function runTick(): Promise<void> {
  await discovery.runOnce();
  await fetcher.runOnce();
}

const cron = makeCronRunner({
  expression: Env.NEWS_POLL_CRON,
  logger,
  onTick: runTick,
});

await makeMigrateDB({ url: Env.DATABASE_URL, tracer })();
await producer.connect();

const server = Bun.serve({
  port: Env.PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === '/health') {
      return tracer.with('GET /health', async (ctx) => {
        ctx.annotate('http.route', '/health');
        ctx.log.info({ method: req.method }, 'health check');
        return Response.json({
          status: 'ok',
          service: 'news-worker',
          version: VERSION,
          commit: COMMIT,
        });
      });
    }

    return new Response('Not found', { status: 404 });
  },
});

logger.info(
  { port: server.port, version: VERSION, commit: COMMIT, pollCron: Env.NEWS_POLL_CRON },
  'news-worker listening',
);

cron.start();

// Eager first tick — avoids a cold-start wait on first deploy.
void runTick().catch((err) => logger.error({ err }, 'news-worker: initial tick error'));

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'news-worker: shutting down');
  cron.stop();
  server.stop();
  try {
    await browser.close();
  } catch (err) {
    logger.warn({ err }, 'news-worker: browser close failed');
  }
  try {
    await producer.disconnect();
  } catch (err) {
    logger.warn({ err }, 'news-worker: producer disconnect failed');
  }
  await tracer.shutdown();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
