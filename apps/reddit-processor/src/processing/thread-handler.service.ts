import type { DBClient, RedditThread } from '@modules/db';
import { schema } from '@modules/db';
import type { Message } from '@modules/events';
import type { GraphClient } from '@modules/graph-db';
import type { Context, Tracer } from '@modules/tracing';
import { eq } from 'drizzle-orm';
import type { TickerExtractorService } from '@/inference/ticker-extractor.service';

const GRAPH_NAME = 'reddit';

export interface MakeThreadHandlerServiceOpts {
  db: DBClient;
  graphClient: GraphClient;
  tracer: Tracer;
  tickerExtractor: TickerExtractorService;
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

interface ThreadData {
  id: number;
  redditId: string;
  title: string;
  subreddit: string;
  author: string;
  score: number;
  createdUtc: string;
}

async function saveThreadToGraph(
  thread: ThreadData,
  tickers: string[],
  graphClient: GraphClient,
  tracer: Tracer,
): Promise<void> {
  return tracer.with(`Save thread ${thread.id} to graph`, async (ctx) => {
    const graph = graphClient.selectGraph(GRAPH_NAME);

    await graph.mergeNode('Subreddit', { name: thread.subreddit });
    ctx.log.debug({ subreddit: thread.subreddit }, 'Subreddit node merged');

    await graph.mergeNode('Author', { username: thread.author });
    ctx.log.debug({ author: thread.author }, 'Author node merged');

    // TODO add a layer of type safety for the client (nodes & edges)
    await graph.createRelationship(
      'Subreddit',
      { name: thread.subreddit },
      'POSTED_IN',
      'Author',
      { username: thread.author },
    );
    ctx.log.debug(
      { subreddit: thread.subreddit, author: thread.author },
      'POSTED_IN relationship from subreddit to author created',
    );

    for (const ticker of tickers) {
      const normalizedTicker = ticker.trim().toUpperCase();
      if (normalizedTicker.length === 0) {
        continue;
      }

      await graph.mergeNode('Ticker', { symbol: normalizedTicker });
      ctx.log.debug({ ticker: normalizedTicker }, 'Ticker node merged');

      await graph.createRelationship(
        'Author',
        { username: thread.author },
        'TALKED_ABOUT',
        'Ticker',
        { symbol: normalizedTicker },
      );
      ctx.log.debug(
        { author: thread.author, ticker: normalizedTicker },
        'TALKED_ABOUT relationship created',
      );
    }
  });
}

export function makeThreadHandlerService(opts: MakeThreadHandlerServiceOpts) {
  const { db, graphClient, tracer, tickerExtractor } = opts;

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

          c.log.info(
            {
              threadId: thread.id,
              redditId: thread.redditId,
              title: thread.title,
              author: thread.author,
              score: thread.score,
              numComments: thread.numComments,
            },
            'Processing thread',
          );

          const tickers = await tickerExtractor
            .extractTickers(thread as RedditThread, c)
            .catch(() => []);
          c.log.info({ threadId: thread.id, tickers }, 'Tickers extracted from thread');

          try {
            await saveThreadToGraph(thread, tickers, graphClient, tracer);
            c.log.info({ threadId: thread.id }, 'Thread saved to graph');
          } catch (graphError) {
            c.log.error(
              { error: graphError, threadId: thread.id },
              'Failed to save thread to graph (non-blocking)',
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
