import Env from '@/env';
import { makeReplyFetcherService } from '@/scraping/reply-fetcher.service';
import { makeThreadFetcherService } from '@/scraping/thread-fetcher.service';
import { makeDBClient, makeMigrateDB } from '@modules/db';
import { makeConsumer, makeProducer, type Message } from '@modules/events';
import { makeLogger } from '@modules/logger';
import {
  makeRedditApiResponseHandlerRegistry,
  type RedditApiResponseEvent,
} from '@modules/reddit-client';
import { makeTracer, type Context } from '@modules/tracing';
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

// Create global response handler registry
const responseHandlerRegistry = makeRedditApiResponseHandlerRegistry({
  logger,
  tracer,
});

// Generic response handler that routes to registry
async function handleRedditApiResponse(
  message: Message<RedditApiResponseEvent>,
  context: Context,
): Promise<void> {
  await responseHandlerRegistry.handle(message, context);
}

const replyFetcher = makeReplyFetcherService({
  db,
  tracer,
  producer,
  broker: Env.BROKER_URL,
  logger,
  responseHandlerRegistry,
});

const threadFetcher = makeThreadFetcherService({
  db,
  tracer,
  producer,
  broker: Env.BROKER_URL,
  logger,
  replyFetcher,
  responseHandlerRegistry,
});

// Set up consumer for API responses
const consumer = makeConsumer({
  broker: Env.BROKER_URL,
  logger,
  tracing: { tracer },
  prefetch: 10,
  handlers: [
    {
      domain: 'reddit',
      queue: 'reddit.api-call.responses',
      routingKey: 'reddit.api-call.*.succeeded',
      onMessage: handleRedditApiResponse,
    },
    {
      domain: 'reddit',
      queue: 'reddit.api-call.responses',
      routingKey: 'reddit.api-call.*.failed',
      onMessage: handleRedditApiResponse,
    },
  ],
});

await consumer.connect();

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
