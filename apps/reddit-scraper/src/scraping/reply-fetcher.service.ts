import type { DBClient, RedditReply } from '@modules/db';
import { makeRedditReplyInsertValue, schema, eq, inArray } from '@modules/db';
import { makeEvent, type Producer } from '@modules/events';
import type { Context, Tracer } from '@modules/tracing';
import type { RedditReply as RawRedditReply, RedditClient } from '@modules/reddit-client';

function ensureExists<T>(
  value: T | undefined | null,
  ctx: Context,
  message?: string,
): asserts value is T {
  if (value === undefined || value === null) {
    const errorMessage = message || 'Expected value to exist but got undefined/null';
    ctx.log.error(errorMessage);
    throw new Error(errorMessage);
  }
}

export interface MakeReplyFetcherServiceOpts {
  db: DBClient;
  tracer: Tracer;
  producer: Producer;
}

export function makeReplyFetcherService(opts: MakeReplyFetcherServiceOpts) {
  const { db, tracer, producer } = opts;

  async function fetchRepliesForThread(
    threadRedditId: string,
    subreddit: string,
    redditClient: RedditClient,
  ): Promise<RawRedditReply[]> {
    return tracer.with(`Fetch replies for thread ${threadRedditId}`, async (ctx) => {
      const replies = await redditClient.fetchThreadReplies(threadRedditId, subreddit);
      ctx.log.info(
        { threadRedditId, count: replies.length },
        `Fetched ${replies.length} replies for thread`,
      );
      return replies;
    });
  }

  async function findNewReplies(replies: RawRedditReply[]): Promise<RawRedditReply[]> {
    return tracer.with('Find new replies', async (ctx) => {
      const redditIds = replies.map((r) => r.id);
      if (redditIds.length === 0) {
        return [];
      }

      const existingReplies = await db
        .select({ redditId: schema.redditReplies.redditId })
        .from(schema.redditReplies)
        .where(inArray(schema.redditReplies.redditId, redditIds));

      const existingRedditIds = new Set(existingReplies.map((r) => r.redditId));
      const newReplies = replies.filter((r) => !existingRedditIds.has(r.id));

      ctx.log.info(
        { new: newReplies.length, existing: existingRedditIds.size },
        `Found ${newReplies.length} new replies, ${existingRedditIds.size} already exist`,
      );

      return newReplies;
    });
  }

  async function saveReplyToDB(
    reply: RawRedditReply,
    threadId: number,
  ): Promise<RedditReply> {
    return tracer.with(`Save reply ${reply.id}`, async (ctx) => {
      const parentRedditId =
        !reply.parent_id || reply.parent_id.startsWith('t3_')
          ? null
          : reply.parent_id.replace('t1_', '');

      const [insertedReply] = await db
        .insert(schema.redditReplies)
        .values(
          makeRedditReplyInsertValue({
            redditId: reply.id,
            threadId,
            parentRedditId,
            author: reply.author || '[deleted]',
            body: reply.body || '',
            score: reply.score ?? 0,
            createdUtc: new Date((reply.created_utc ?? 0) * 1000).toISOString(),
            status: 'pending',
            data: reply,
          }),
        )
        .returning();

      ensureExists(
        insertedReply,
        ctx,
        `Failed to insert reply with reddit_id: ${reply.id}`,
      );

      ctx.log.debug(
        { replyId: insertedReply.id, redditId: reply.id },
        'Reply saved to database',
      );

      return insertedReply as RedditReply;
    });
  }

  async function emitReplyFetchedEvent(reply: RedditReply): Promise<void> {
    return tracer.with(`Emit event for reply ${reply.id}`, async (ctx) => {
      const event = makeEvent('reddit-reply', 'fetched', {
        id: reply.id,
        reddit_id: reply.redditId,
        thread_id: reply.threadId,
      });

      await producer.send('reddit', 'reddit.reply.fetched', event, {
        baggage: {
          'reply.id': reply.id.toString(),
          'reply.reddit_id': reply.redditId,
          'thread.id': reply.threadId.toString(),
        },
      });

      ctx.log.debug({ replyId: reply.id }, 'Event emitted for reply');
    });
  }

  async function processNewReplies(
    newReplies: RawRedditReply[],
    threadId: number,
  ): Promise<void> {
    for (const reply of newReplies) {
      await tracer.with('Process reply', async (ctx) => {
        ctx.annotate('reply.id', reply.id);
        ctx.annotate('thread.id', threadId);

        const insertedReply = await saveReplyToDB(reply, threadId);
        await emitReplyFetchedEvent(insertedReply);
      });
    }
  }

  async function shouldFetchRepliesForThread(threadId: number): Promise<boolean> {
    return tracer.with(
      `Check if should fetch replies for thread ${threadId}`,
      async (ctx) => {
        const [thread] = await db
          .select({
            status: schema.redditThreads.status,
            lastReplyFetchAt: schema.redditThreads.lastReplyFetchAt,
          })
          .from(schema.redditThreads)
          .where(eq(schema.redditThreads.id, threadId))
          .limit(1);

        if (!thread) {
          ctx.log.warn({ threadId }, 'Thread not found');
          return false;
        }

        if (thread.status !== 'processed') {
          ctx.log.debug(
            { threadId, status: thread.status },
            'Thread not processed yet, will fetch replies',
          );
          return true;
        }

        if (!thread.lastReplyFetchAt) {
          ctx.log.debug({ threadId }, 'Thread never had replies fetched, will fetch');
          return true;
        }

        const lastFetch = new Date(thread.lastReplyFetchAt);
        const now = new Date();
        const hoursSinceLastFetch =
          (now.getTime() - lastFetch.getTime()) / (1000 * 60 * 60);

        if (hoursSinceLastFetch >= 24) {
          ctx.log.debug(
            { threadId, hoursSinceLastFetch: Math.round(hoursSinceLastFetch) },
            'Last fetch was more than 24 hours ago, will fetch',
          );
          return true;
        }

        ctx.log.debug(
          { threadId, hoursSinceLastFetch: Math.round(hoursSinceLastFetch) },
          'Last fetch was less than 24 hours ago, skipping',
        );
        return false;
      },
    );
  }

  async function updateThreadLastReplyFetch(threadId: number): Promise<void> {
    return tracer.with(`Update lastReplyFetchAt for thread ${threadId}`, async (ctx) => {
      await db
        .update(schema.redditThreads)
        .set({
          lastReplyFetchAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.redditThreads.id, threadId));

      ctx.log.debug({ threadId }, 'Updated lastReplyFetchAt timestamp');
    });
  }

  return {
    async fetchRepliesForThread(
      threadRedditId: string,
      subreddit: string,
      threadId: number,
      redditClient: RedditClient,
    ) {
      const replies = await fetchRepliesForThread(
        threadRedditId,
        subreddit,
        redditClient,
      );
      const newReplies = await findNewReplies(replies);

      if (newReplies.length > 0) {
        await processNewReplies(newReplies, threadId);
      }

      return newReplies.length;
    },
    shouldFetchRepliesForThread(threadId: number) {
      return shouldFetchRepliesForThread(threadId);
    },
    updateThreadLastReplyFetch(threadId: number) {
      return updateThreadLastReplyFetch(threadId);
    },
  };
}
