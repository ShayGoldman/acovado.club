import type { DBClient, RedditThread } from '@modules/db';
import { makeRedditThread } from '@modules/db';
import { schema } from '@modules/db';
import type { Message, Producer } from '@modules/events';
import type { GraphClient } from '@modules/graph-db';
import type { Context, Tracer } from '@modules/tracing';
import { eq } from '@modules/db';
import type {
  TickerExtractorService,
  TickerReference,
  TickerClassification,
} from '@/inference/ticker-extractor.service';
import { makeTrackedSubredditDiscoveryService } from './tracked-subreddit-discovery.service';

const GRAPH_NAME = 'reddit';

function classificationToRelationshipType(classification: TickerClassification): string {
  const mapping: Record<TickerClassification, string> = {
    has_position: 'HAS_POSITION',
    recommends: 'RECOMMENDS',
    warns_against: 'WARNS_AGAINST',
    sold_position: 'SOLD_POSITION',
  };
  return mapping[classification];
}

export interface MakeThreadHandlerServiceOpts {
  db: DBClient;
  graphClient: GraphClient;
  tracer: Tracer;
  tickerExtractor: TickerExtractorService;
  producer: Producer;
}

interface ThreadFetchedPayload {
  id: number;
  resource: string;
  data: {
    id: number;
    reddit_id: string;
    subreddit: string;
  };
  type: string;
  timestamp: Date;
}

async function saveThreadToGraph(
  thread: RedditThread,
  references: TickerReference[],
  graphClient: GraphClient,
  tracer: Tracer,
): Promise<void> {
  return tracer.with(`Save thread ${thread.id} to graph`, async (ctx) => {
    const graph = graphClient.selectGraph(GRAPH_NAME);

    await graph.mergeNode(
      'Subreddit',
      { name: thread.subreddit },
      { title: `r/${thread.subreddit}` },
    );
    ctx.log.debug({ subreddit: thread.subreddit }, 'Subreddit node merged');

    await graph.mergeNode(
      'Author',
      { username: thread.author },
      { title: thread.author },
    );
    ctx.log.debug({ author: thread.author }, 'Author node merged');

    await graph.createRelationship(
      'Author',
      { username: thread.author },
      'POSTED_IN',
      'Subreddit',
      { name: thread.subreddit },
    );
    ctx.log.debug(
      { subreddit: thread.subreddit, author: thread.author },
      'POSTED_IN relationship from author to subreddit created',
    );

    for (const ref of references) {
      const normalizedTicker = ref.ticker.trim().toUpperCase();
      if (normalizedTicker.length === 0) {
        continue;
      }

      await graph.mergeNode(
        'Ticker',
        { symbol: normalizedTicker },
        { title: normalizedTicker },
      );
      ctx.log.debug({ ticker: normalizedTicker }, 'Ticker node merged');

      const relationshipType = classificationToRelationshipType(ref.classification);

      await graph.mergeRelationshipWithProperties(
        'Author',
        { username: thread.author },
        relationshipType,
        'Ticker',
        { symbol: normalizedTicker },
        {
          reference: ref.reference,
          source: thread.selftext || thread.title,
          reasoning: ref.reasoning,
        },
      );
      ctx.log.debug(
        {
          author: thread.author,
          ticker: normalizedTicker,
          classification: ref.classification,
          relationshipType,
        },
        'Classification-based relationship created',
      );
    }
  });
}

export function makeThreadHandlerService(opts: MakeThreadHandlerServiceOpts) {
  const { db, graphClient, tracer, tickerExtractor, producer } = opts;

  const trackedSubredditDiscovery = makeTrackedSubredditDiscoveryService({
    db,
    producer,
    tracer,
  });

  return {
    async onThreadFetched(message: Message<ThreadFetchedPayload>, context: Context) {
      await context.with('Process reddit thread', async (c) => {
        const { id, reddit_id, subreddit } = message.payload.data;

        c.log.info(
          { threadId: id, redditId: reddit_id, subreddit },
          'Received thread fetched event',
        );

        try {
          const [thread] = await db
            .select()
            .from(schema.redditThreads)
            .where(eq(schema.redditThreads.id, id))
            .limit(1);

          if (!thread) {
            c.log.error({ threadId: id }, 'Thread not found in database');
            return;
          }

          const redditThread = makeRedditThread(thread);

          c.log.info(
            {
              threadId: redditThread.id,
              redditId: redditThread.redditId,
              title: redditThread.title,
              author: redditThread.author,
              score: redditThread.score,
              numComments: redditThread.numComments,
            },
            'Processing thread',
          );

          const references = await tickerExtractor
            .extractTickers(redditThread, c)
            .catch(() => []);
          c.log.info(
            { threadId: redditThread.id, referenceCount: references.length },
            'Ticker references extracted from thread',
          );

          try {
            await saveThreadToGraph(redditThread, references, graphClient, tracer);
            c.log.info({ threadId: redditThread.id }, 'Thread saved to graph');
          } catch (graphError) {
            c.log.error(
              { error: graphError, threadId: redditThread.id },
              'Failed to save thread to graph (non-blocking)',
            );
          }

          try {
            await trackedSubredditDiscovery.discoverSubreddits(redditThread);
          } catch (discoveryError) {
            c.log.error(
              { error: discoveryError, threadId: redditThread.id },
              'Failed to discover tracked subreddits (non-blocking)',
            );
          }

          await db
            .update(schema.redditThreads)
            .set({
              status: 'processed',
              updatedAt: new Date().toISOString(),
            })
            .where(eq(schema.redditThreads.id, id));

          c.log.info({ threadId: id }, 'Thread marked as processed');
        } catch (error) {
          c.log.error({ error, threadId: id }, 'Failed to process thread');

          try {
            await db
              .update(schema.redditThreads)
              .set({
                status: 'error',
                updatedAt: new Date().toISOString(),
              })
              .where(eq(schema.redditThreads.id, id));
          } catch (updateError) {
            c.log.error({ error: updateError }, 'Failed to mark thread as error');
          }

          throw error;
        }
      });
    },
  };
}
