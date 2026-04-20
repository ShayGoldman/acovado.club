import { parseEnv } from '@/env';
import { makeProducer } from '@modules/events';
import { makeLogger } from '@modules/logger';
import { makeTracer } from '@modules/tracing';
import { type Browser, chromium } from 'playwright';
import pkg from '../package.json' with { type: 'json' };

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

const producer = makeProducer({ broker: Env.RABBITMQ_URL, logger, tracing: { tracer } });

// Launch the browser at boot so the production image is proven to bring Chromium up
// end-to-end; M2+ reuses this singleton for discovery/fetch.
const browser: Browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox'],
});
logger.info(
  { playwrightBrowser: 'chromium', browserVersion: browser.version() },
  'chromium launched',
);

// Connect the producer in the background. We never publish in M1, but we keep the
// startup shape M4 will need. Non-blocking so /health stays up if RabbitMQ is
// unreachable at boot — the container must not crash-loop on infra flake.
let producerConnected = false;
void (async function connectProducer(): Promise<void> {
  const backoffMs = [1_000, 2_000, 5_000, 10_000, 30_000];
  let attempt = 0;
  while (!producerConnected) {
    try {
      await producer.connect();
      producerConnected = true;
      logger.info('producer connected');
      return;
    } catch (err) {
      const delay = backoffMs[Math.min(attempt, backoffMs.length - 1)] ?? 30_000;
      logger.warn(
        { err, attempt, retryInMs: delay },
        'producer connect failed; retrying in background',
      );
      attempt += 1;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
})();

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
          producer: producerConnected ? 'connected' : 'pending',
        });
      });
    }

    return new Response('Not found', { status: 404 });
  },
});

logger.info(
  { port: server.port, version: VERSION, commit: COMMIT },
  'news-worker listening',
);

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'news-worker: shutting down');
  server.stop();
  try {
    await browser.close();
  } catch (err) {
    logger.warn({ err }, 'news-worker: browser close failed');
  }
  try {
    if (producerConnected) await producer.disconnect();
  } catch (err) {
    logger.warn({ err }, 'news-worker: producer disconnect failed');
  }
  await tracer.shutdown();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
