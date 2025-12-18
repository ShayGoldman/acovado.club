import type { DBClient, RedditReply } from '@modules/db';
import { schema } from '@modules/db';
import type { Message } from '@modules/events';
import type { GraphClient } from '@modules/graph-db';
import type { Context, Tracer } from '@modules/tracing';
import { eq } from 'drizzle-orm';
import type { TickerExtractorService } from '@/inference/ticker-extractor.service';
import type { ReplyContextService } from '@/processing/reply-context.service';

const GRAPH_NAME = 'reddit';

export interface MakeReplyHandlerServiceOpts {
  db: DBClient;
  graphClient: GraphClient;
  tracer: Tracer;
  tickerExtractor: TickerExtractorService;
  replyContextService: ReplyContextService;
}

interface ReplyFetchedPayload {
  id: number;
  resource: string;
  data: {
    id: number;
    reddit_id: string;
    thread_id: number;
  };
  type: string;
  timestamp: Date;
}

export function makeReplyHandlerService(opts: MakeReplyHandlerServiceOpts) {
  const { db, graphClient, tracer, tickerExtractor, replyContextService } = opts;

  async function saveReplyToGraph(reply: RedditReply, tickers: string[]): Promise<void> {
    return tracer.with(`Save reply ${reply.id} to graph`, async (ctx) => {
      const graph = graphClient.selectGraph(GRAPH_NAME);

      await graph.mergeNode(
        'Author',
        { username: reply.author },
        { title: reply.author },
      );
      ctx.log.debug({ author: reply.author }, 'Author node merged');

      const today = new Date().toISOString().split('T')[0];

      for (const ticker of tickers) {
        const normalizedTicker = ticker.trim().toUpperCase();
        if (normalizedTicker.length === 0) {
          continue;
        }

        await graph.mergeNode(
          'Ticker',
          { symbol: normalizedTicker },
          { title: normalizedTicker },
        );
        ctx.log.debug({ ticker: normalizedTicker }, 'Ticker node merged');

        const fromMatch = `username: ${JSON.stringify(reply.author)}`;
        const toMatch = `symbol: ${JSON.stringify(normalizedTicker)}`;

        const result = await graph.query(`
          MATCH (a:Author {${fromMatch}}), (t:Ticker {${toMatch}})
          MERGE (a)-[r:TALKED_ABOUT]->(t)
          ON CREATE SET r.lastUpdated = '${today}', r.firstSeen = '${today}', r.updateCount = 1
          RETURN r.lastUpdated as lastUpdated
        `);

        if (result.data.length > 0) {
          const row = result.data[0];
          const lastUpdated = row?.[0] as string | null | undefined;

          if (lastUpdated) {
            const lastUpdatedDate = new Date(lastUpdated);
            const todayDate = new Date(`${today}T00:00:00`);

            if (lastUpdatedDate < todayDate) {
              await graph.query(`
                MATCH (a:Author {${fromMatch}}), (t:Ticker {${toMatch}})
                MATCH (a)-[r:TALKED_ABOUT]->(t)
                SET r.lastUpdated = '${today}', r.updateCount = COALESCE(r.updateCount, 0) + 1
                RETURN r
              `);
            }
          }
        }

        ctx.log.debug(
          { author: reply.author, ticker: normalizedTicker },
          'TALKED_ABOUT relationship created/updated',
        );
      }
    });
  }

  return {
    async onReplyFetched(message: Message<ReplyFetchedPayload>, context: Context) {
      await context.with('Process reddit reply', async (c) => {
        const { id, reddit_id, thread_id } = message.payload.data;

        c.log.info(
          { replyId: id, redditId: reddit_id, threadId: thread_id },
          'Received reply fetched event',
        );

        try {
          const [reply] = await db
            .select()
            .from(schema.redditReplies)
            .where(eq(schema.redditReplies.id, id))
            .limit(1);

          if (!reply) {
            c.log.error({ replyId: id }, 'Reply not found in database');
            return;
          }

          c.log.info(
            {
              replyId: reply.id,
              redditId: reply.redditId,
              author: reply.author,
              threadId: reply.threadId,
            },
            'Processing reply',
          );

          const contextTree = await replyContextService.buildReplyTree(reply.id);
          c.log.debug({ replyId: reply.id }, 'Reply context tree built');

          const tickers = await tickerExtractor
            .extractTickersFromReply(reply as RedditReply, contextTree, c)
            .catch(() => []);
          c.log.info({ replyId: reply.id, tickers }, 'Tickers extracted from reply');

          if (tickers.length > 0) {
            try {
              await saveReplyToGraph(reply as RedditReply, tickers);
              c.log.info({ replyId: reply.id }, 'Reply saved to graph');
            } catch (graphError) {
              c.log.error(
                { error: graphError, replyId: reply.id },
                'Failed to save reply to graph (non-blocking)',
              );
            }
          }

          await db
            .update(schema.redditReplies)
            .set({
              status: 'processed',
              updatedAt: new Date().toISOString(),
            })
            .where(eq(schema.redditReplies.id, id));

          c.log.info({ replyId: id }, 'Reply marked as processed');
        } catch (error) {
          c.log.error({ error, replyId: id }, 'Failed to process reply');

          try {
            await db
              .update(schema.redditReplies)
              .set({
                status: 'error',
                updatedAt: new Date().toISOString(),
              })
              .where(eq(schema.redditReplies.id, id));
          } catch (updateError) {
            c.log.error({ error: updateError }, 'Failed to mark reply as error');
          }

          throw error;
        }
      });
    },
  };
}
