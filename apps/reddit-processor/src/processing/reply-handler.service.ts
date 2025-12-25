import type { DBClient, RedditReply } from '@modules/db';
import { makeRedditReply } from '@modules/db';
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
import { normalizeContextTree } from '@/inference/ticker-extractor.service';
import type { ReplyContextService, ReplyTree } from '@/processing/reply-context.service';
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

export interface MakeReplyHandlerServiceOpts {
  db: DBClient;
  graphClient: GraphClient;
  tracer: Tracer;
  tickerExtractor: TickerExtractorService;
  replyContextService: ReplyContextService;
  producer: Producer;
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
  const { db, graphClient, tracer, tickerExtractor, replyContextService, producer } =
    opts;

  const trackedSubredditDiscovery = makeTrackedSubredditDiscoveryService({
    db,
    producer,
    tracer,
  });

  async function saveReplyToGraph(
    reply: RedditReply,
    references: TickerReference[],
    contextTree: ReplyTree,
  ): Promise<void> {
    return tracer.with(`Save reply ${reply.id} to graph`, async (ctx) => {
      ctx.annotate('reply.id', reply.id);
      ctx.annotate('reply.redditId', reply.redditId);
      ctx.annotate('thread.id', reply.threadId);
      ctx.annotate('graph.node.author.username', reply.author);

      const graph = graphClient.selectGraph(GRAPH_NAME);

      const authorResult = await graph.mergeNode(
        'Author',
        { username: reply.author },
        { title: reply.author },
      );
      if (authorResult.node) {
        ctx.annotate('graph.node.author.id', authorResult.node.id);
      }
      ctx.log.debug({ author: reply.author }, 'Author node merged');

      const relationshipIds: number[] = [];
      const tickerSymbols: string[] = [];

      for (const ref of references) {
        const normalizedTicker = ref.ticker.trim().toUpperCase();
        if (normalizedTicker.length === 0) {
          continue;
        }

        tickerSymbols.push(normalizedTicker);

        const tickerResult = await graph.mergeNode(
          'Ticker',
          { symbol: normalizedTicker },
          { title: normalizedTicker },
        );
        if (tickerResult.node) {
          ctx.annotate('graph.node.ticker.id', tickerResult.node.id);
        }
        ctx.log.debug({ ticker: normalizedTicker }, 'Ticker node merged');

        const relationshipType = classificationToRelationshipType(ref.classification);

        const threadTree = normalizeContextTree(contextTree);

        const relationshipResult = await graph.mergeRelationshipWithProperties(
          'Author',
          { username: reply.author },
          relationshipType,
          'Ticker',
          { symbol: normalizedTicker },
          {
            reference: ref.reference,
            source: reply.body,
            reasoning: ref.reasoning,
            threadTree,
          },
        );
        if (relationshipResult.relationship) {
          relationshipIds.push(relationshipResult.relationship.id);
          ctx.annotate(
            `graph.relationship.${normalizedTicker}.id`,
            relationshipResult.relationship.id,
          );
          ctx.annotate(`graph.relationship.${normalizedTicker}.type`, relationshipType);
        }
        ctx.log.debug(
          {
            author: reply.author,
            ticker: normalizedTicker,
            classification: ref.classification,
            relationshipType,
          },
          'Classification-based relationship created',
        );
      }

      ctx.annotate('graph.node.ticker.count', tickerSymbols.length);
      ctx.annotate('graph.relationship.count', relationshipIds.length);
      if (tickerSymbols.length > 0) {
        ctx.annotate('graph.node.ticker.symbols', tickerSymbols.join(','));
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

          // TODO need to hash replies to check if they have been edited, or a property (better)
          if (reply.status === 'processed') {
            c.log.info({ replyId: id }, 'Reply already processed, skipping');
            return;
          }

          const redditReply = makeRedditReply(reply);

          c.annotate('reply.id', redditReply.id);
          c.annotate('reply.redditId', redditReply.redditId);
          c.annotate('thread.id', redditReply.threadId);
          c.annotate('graph.node.author.username', redditReply.author);

          c.log.info(
            {
              replyId: redditReply.id,
              redditId: redditReply.redditId,
              author: redditReply.author,
              threadId: redditReply.threadId,
            },
            'Processing reply',
          );

          const contextTree = await replyContextService.buildReplyTree(redditReply.id);
          c.log.debug({ replyId: redditReply.id }, 'Reply context tree built');

          const references = await tickerExtractor
            .extractTickersFromReply(redditReply, contextTree, c)
            .catch(() => []);
          c.log.info(
            { replyId: redditReply.id, referenceCount: references.length },
            'Ticker references extracted from reply',
          );

          if (references.length > 0) {
            try {
              await saveReplyToGraph(redditReply, references, contextTree);
              c.log.info({ replyId: redditReply.id }, 'Reply saved to graph');
            } catch (graphError) {
              c.log.error(
                { error: graphError, replyId: reply.id },
                'Failed to save reply to graph (non-blocking)',
              );
            }
          }

          try {
            await trackedSubredditDiscovery.discoverSubredditsFromReply(redditReply);
          } catch (discoveryError) {
            c.log.error(
              { error: discoveryError, replyId: redditReply.id },
              'Failed to discover tracked subreddits (non-blocking)',
            );
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
