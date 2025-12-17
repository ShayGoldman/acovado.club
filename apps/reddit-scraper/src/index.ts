import Env from '@/env';
import { makeThreadFetcherService } from '@/scraping/thread-fetcher.service';
import { makeDBClient, makeMigrateDB } from '@modules/db';
import { makeProducer } from '@modules/events';
import { makeLogger } from '@modules/logger';
import { makeTracer } from '@modules/tracing';
import { CronJob } from 'cron';

const logger = makeLogger({
  name: 'reddit-scraper',
});

const tracer = makeTracer({
  serviceName: 'reddit-scraper',
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

const producer = makeProducer({
  broker: Env.BROKER_URL,
  logger,
  tracing: { tracer },
});

logger.info('Setting up...');
await producer.connect();

const threadFetcher = makeThreadFetcherService({
  db,
  tracer,
  producer,
});

// Cron job: every 10 minutes
const cronJob = new CronJob(
  '*/10 * * * *',
  async () => {
    await tracer.with('Reddit scraper cron job', async (c) => {
      c.log.info('Starting scheduled thread fetch');
      try {
        await threadFetcher.fetchThreads();
        c.log.info('Completed scheduled thread fetch');
      } catch (error) {
        c.log.error({ error }, 'Failed to fetch threads');
      }
    });
  },
  null,
  null,
  null,
  null,
  Env.CRONS_START_ON_INIT,
);

logger.info('Starting cron job...');
cronJob.start();
logger.info('Reddit scraper is running');
