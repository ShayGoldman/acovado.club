import Env from '@/env';
import { makeTickerExtractorService } from '@/inference/ticker-extractor.service';
import { makeReplyContextService } from '@/processing/reply-context.service';
import { makeReplyHandlerService } from '@/processing/reply-handler.service';
import { makeTrackedSubredditCandidateHandlerService } from '@/processing/tracked-subreddit-candidate-handler.service';
import { makeThreadHandlerService } from '@/processing/thread-handler.service';
import { makeDBClient, makeMigrateDB } from '@modules/db';
import { makeConsumer, makeProducer } from '@modules/events';
import { makeGraphClient } from '@modules/graph-db';
import { makeInferenceClient } from '@modules/inference';
import { makeLogger } from '@modules/logger';
import { makeRedditApiResponseHandlerRegistry } from '@modules/reddit-client';
import { makeTracer } from '@modules/tracing';

const logger = makeLogger({
  name: 'reddit-processor',
  level: 'info',
});

const tracer = makeTracer({
  serviceName: 'reddit-processor',
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

const graphClient = makeGraphClient({
  url: Env.GRAPH_DB_URL,
  tracer,
});

logger.info('Setting up...');
await graphClient.connect();

const inference = makeInferenceClient({
  db,
  tracer,
});

const tickerExtractor = makeTickerExtractorService({
  ollamaBaseUrl: Env.OLLAMA_BASE_URL,
  inference,
});

const replyContextService = makeReplyContextService({
  db,
  tracer,
});

const producer = makeProducer({
  broker: Env.BROKER_URL,
  logger,
  tracing: { tracer },
});

await producer.connect();

// Create global response handler registry
const responseHandlerRegistry = makeRedditApiResponseHandlerRegistry({
  logger,
  tracer,
});

const threadHandler = makeThreadHandlerService({
  db,
  graphClient,
  tracer,
  tickerExtractor,
  producer,
});

const replyHandler = makeReplyHandlerService({
  db,
  graphClient,
  tracer,
  tickerExtractor,
  replyContextService,
  producer,
});

const trackedSubredditCandidateHandler = makeTrackedSubredditCandidateHandlerService({
  db,
  tracer,
  inference,
  ollamaBaseUrl: Env.OLLAMA_BASE_URL,
  broker: Env.BROKER_URL,
  logger,
  producer,
  responseHandlerRegistry,
});

const consumer = makeConsumer({
  broker: Env.BROKER_URL,
  logger,
  tracing: { tracer },
  prefetch: 10,
  handlers: [
    {
      domain: 'reddit',
      queue: 'reddit.thread.fetched',
      routingKey: 'reddit.thread.fetched',
      onMessage: threadHandler.onThreadFetched,
    },
    {
      domain: 'reddit',
      queue: 'reddit.reply.fetched',
      routingKey: 'reddit.reply.fetched',
      onMessage: replyHandler.onReplyFetched,
    },
    {
      domain: 'reddit',
      queue: 'reddit.tracked-subreddit.candidate-discovered',
      routingKey: 'reddit.tracked-subreddit.candidate-discovered',
      onMessage: trackedSubredditCandidateHandler.onTrackedSubredditCandidateDiscovered,
    },
    {
      domain: 'reddit',
      queue: 'reddit.api-call.responses',
      routingKey: 'reddit.api-call.*.succeeded',
      onMessage: responseHandlerRegistry.handle,
    },
    {
      domain: 'reddit',
      queue: 'reddit.api-call.responses',
      routingKey: 'reddit.api-call.*.failed',
      onMessage: responseHandlerRegistry.handle,
    },
  ],
});

await consumer.connect();

logger.info('Reddit processor is running');
