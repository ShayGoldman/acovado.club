import type { DBClient, RedditThread } from '@modules/db';
import { makeRedditThread, schema } from '@modules/db';
import { makeEvent, type Producer } from '@modules/events';
import type { Context, Tracer } from '@modules/tracing';
import { eq, inArray } from 'drizzle-orm';
import type { RedditThread as RawRedditThread } from './reddit-client';
import { makeRedditClient } from './reddit-client';
import type { makeReplyFetcherService } from './reply-fetcher.service';

const SUBREDDITS = ['ValueInvesting'] as const;

// TODO extract this to a module
// TODO Add type safety to the function so that non-null or undefined values are not allowed
/**
 * Ensures a value exists or throws an error with context logging
 */
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

export interface MakeThreadFetcherServiceOpts {
  db: DBClient;
  tracer: Tracer;
  producer: Producer;
  replyFetcher?: ReturnType<typeof makeReplyFetcherService>;
}

/**
 * Fetches threads from Reddit for a given subreddit
 */
async function fetchThreadsFromReddit(
  subreddit: string,
  redditClient: ReturnType<typeof makeRedditClient>,
  tracer: Tracer,
): Promise<RawRedditThread[]> {
  return tracer.with(`Fetch threads from /r/${subreddit}`, async (ctx) => {
    const threads = await redditClient.fetchSubredditThreads(subreddit);
    ctx.log.info(
      { subreddit, count: threads.length },
      `Fetched ${threads.length} threads from /r/${subreddit}`,
    );
    return threads;
  });
}

/**
 * Finds which threads are new (not already in the database)
 */
async function findNewThreads(
  threads: RawRedditThread[],
  db: DBClient,
  tracer: Tracer,
): Promise<RawRedditThread[]> {
  return tracer.with('Find new threads', async (ctx) => {
    const redditIds = threads.map((t) => t.id);
    const existingThreads = await db
      .select({ redditId: schema.redditThreads.redditId })
      .from(schema.redditThreads)
      .where(inArray(schema.redditThreads.redditId, redditIds));

    const existingRedditIds = new Set(existingThreads.map((t) => t.redditId));
    const newThreads = threads.filter((t) => !existingRedditIds.has(t.id));

    ctx.log.info(
      { new: newThreads.length, existing: existingRedditIds.size },
      `Found ${newThreads.length} new threads, ${existingRedditIds.size} already exist`,
    );

    return newThreads;
  });
}

/**
 * Saves a thread to the database
 */
async function saveThreadToDB(
  thread: RawRedditThread,
  db: DBClient,
  tracer: Tracer,
): Promise<RedditThread> {
  return tracer.with(`Save thread ${thread.id}`, async (ctx) => {
    const [insertedThread] = await db
      .insert(schema.redditThreads)
      .values(
        makeRedditThread({
          redditId: thread.id,
          subreddit: thread.subreddit,
          title: thread.title,
          author: thread.author,
          selftext: thread.selftext,
          url: thread.url,
          permalink: thread.permalink,
          score: thread.score,
          numComments: thread.num_comments,
          createdUtc: new Date(thread.created_utc * 1000).toISOString(),
          status: 'pending',
          data: thread,
        }),
      )
      .returning();

    ensureExists(
      insertedThread,
      ctx,
      `Failed to insert thread with reddit_id: ${thread.id}`,
    );

    ctx.log.debug(
      { threadId: insertedThread.id, redditId: thread.id },
      'Thread saved to database',
    );

    return insertedThread as RedditThread;
  });
}

/**
 * Emits an event for a fetched thread
 */
async function emitThreadFetchedEvent(
  thread: RedditThread,
  producer: Producer,
  tracer: Tracer,
): Promise<void> {
  return tracer.with(`Emit event for thread ${thread.id}`, async (ctx) => {
    const event = makeEvent('reddit-thread', 'fetched', {
      id: thread.id,
      reddit_id: thread.redditId,
      subreddit: thread.subreddit,
    });

    await producer.send('reddit', 'reddit.thread.fetched', event, {
      baggage: {
        'thread.id': thread.id.toString(),
        'thread.reddit_id': thread.redditId,
      },
    });

    ctx.log.debug({ threadId: thread.id }, 'Event emitted for thread');
  });
}
//
async function processNewThreads(
  newThreads: RawRedditThread[],
  db: DBClient,
  producer: Producer,
  tracer: Tracer,
): Promise<void> {
  for (const thread of newThreads) {
    tracer.with('Process thread', async (ctx) => {
      ctx.annotate('thread.id', thread.id);
      ctx.annotate('thread.subreddit', thread.subreddit);

      const insertedThread = await saveThreadToDB(thread, db, tracer);
      await emitThreadFetchedEvent(insertedThread, producer, tracer);
    });
  }
}

async function fetchAndProcessReplies(
  thread: RawRedditThread,
  replyFetcher: ReturnType<typeof makeReplyFetcherService>,
  db: DBClient,
  tracer: Tracer,
): Promise<void> {
  return tracer.with(`Fetch replies for thread ${thread.id}`, async (ctx) => {
    const [dbThread] = await db
      .select({ id: schema.redditThreads.id })
      .from(schema.redditThreads)
      .where(eq(schema.redditThreads.redditId, thread.id))
      .limit(1);

    if (!dbThread) {
      ctx.log.warn(
        { redditId: thread.id },
        'Thread not found in database, skipping reply fetch',
      );
      return;
    }

    const shouldFetch = await replyFetcher.shouldFetchRepliesForThread(dbThread.id);
    if (!shouldFetch) {
      return;
    }

    const redditClient = makeRedditClient();
    const subreddit = thread.subreddit.replace('/r/', '');
    const newReplyCount = await replyFetcher.fetchRepliesForThread(
      thread.id,
      subreddit,
      dbThread.id,
      redditClient,
    );

    if (newReplyCount > 0) {
      await replyFetcher.updateThreadLastReplyFetch(dbThread.id);
      ctx.log.info(
        { threadId: dbThread.id, newReplyCount },
        `Fetched ${newReplyCount} new replies for thread`,
      );
    }
  });
}

async function processSubreddit(
  subreddit: string,
  redditClient: ReturnType<typeof makeRedditClient>,
  db: DBClient,
  producer: Producer,
  tracer: Tracer,
  replyFetcher?: ReturnType<typeof makeReplyFetcherService>,
): Promise<void> {
  return tracer.with(`Process /r/${subreddit}`, async (ctx) => {
    try {
      const threads = await fetchThreadsFromReddit(subreddit, redditClient, tracer);

      if (threads.length === 0) {
        ctx.log.info({ subreddit }, 'No threads found');
        return;
      }

      const newThreads = await findNewThreads(threads, db, tracer);

      if (newThreads.length > 0) {
        await processNewThreads(newThreads, db, producer, tracer);
      }

      if (replyFetcher) {
        for (const thread of threads) {
          await fetchAndProcessReplies(thread, replyFetcher, db, tracer);
        }
      }
    } catch (error) {
      ctx.log.error({ error, subreddit }, `Failed to fetch threads from /r/${subreddit}`);
      throw error;
    }
  });
}

export function makeThreadFetcherService(opts: MakeThreadFetcherServiceOpts) {
  const { db, tracer, producer, replyFetcher } = opts;
  const redditClient = makeRedditClient();

  return {
    async fetchThreads() {
      for (const subreddit of SUBREDDITS) {
        await processSubreddit(
          subreddit,
          redditClient,
          db,
          producer,
          tracer,
          replyFetcher,
        );
      }
    },
  };
}
