import type { DBClient, RedditThread } from '@modules/db';
import { makeRedditThread, schema } from '@modules/db';
import { makeEvent, type Producer } from '@modules/events';
import type { Context, Tracer } from '@modules/tracing';
import { inArray } from 'drizzle-orm';
import type { RedditPost } from './reddit-client';
import { makeRedditClient } from './reddit-client';

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
}

/**
 * Fetches threads from Reddit for a given subreddit
 */
async function fetchThreadsFromReddit(
  subreddit: string,
  redditClient: ReturnType<typeof makeRedditClient>,
  tracer: Tracer,
): Promise<RedditPost[]> {
  return tracer.with(`Fetch threads from /r/${subreddit}`, async (ctx) => {
    const posts = await redditClient.fetchSubredditPosts(subreddit);
    ctx.log.info(
      { subreddit, count: posts.length },
      `Fetched ${posts.length} threads from /r/${subreddit}`,
    );
    return posts;
  });
}

/**
 * Finds which threads are new (not already in the database)
 */
async function findNewThreads(
  posts: RedditPost[],
  db: DBClient,
  tracer: Tracer,
): Promise<RedditPost[]> {
  return tracer.with('Find new threads', async (ctx) => {
    const redditIds = posts.map((p) => p.id);
    const existingThreads = await db
      .select({ redditId: schema.redditThreads.redditId })
      .from(schema.redditThreads)
      .where(inArray(schema.redditThreads.redditId, redditIds));

    const existingRedditIds = new Set(existingThreads.map((t) => t.redditId));
    const newPosts = posts.filter((p) => !existingRedditIds.has(p.id));

    ctx.log.info(
      { new: newPosts.length, existing: existingRedditIds.size },
      `Found ${newPosts.length} new threads, ${existingRedditIds.size} already exist`,
    );

    return newPosts;
  });
}

/**
 * Saves a thread to the database
 */
async function saveThreadToDB(
  post: RedditPost,
  db: DBClient,
  tracer: Tracer,
): Promise<RedditThread> {
  return tracer.with(`Save thread ${post.id}`, async (ctx) => {
    const [insertedThread] = await db
      .insert(schema.redditThreads)
      .values(
        makeRedditThread({
          redditId: post.id,
          subreddit: `/r/${post.subreddit}`,
          title: post.title,
          author: post.author,
          selftext: post.selftext,
          url: post.url,
          permalink: post.permalink,
          score: post.score,
          numComments: post.num_comments,
          createdUtc: new Date(post.created_utc * 1000).toISOString(),
          status: 'pending',
          data: post,
        }),
      )
      .returning();

    ensureExists(
      insertedThread,
      ctx,
      `Failed to insert thread with reddit_id: ${post.id}`,
    );

    ctx.log.debug(
      { threadId: insertedThread.id, redditId: post.id },
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
  newPosts: RedditPost[],
  db: DBClient,
  producer: Producer,
  tracer: Tracer,
): Promise<void> {
  for (const post of newPosts) {
    tracer.with('Process thread', async (ctx) => {
      ctx.annotate('thread.id', post.id);
      ctx.annotate('thread.subreddit', post.subreddit);

      const insertedThread = await saveThreadToDB(post, db, tracer);
      await emitThreadFetchedEvent(insertedThread, producer, tracer);
    });
  }
}

async function processSubreddit(
  subreddit: string,
  redditClient: ReturnType<typeof makeRedditClient>,
  db: DBClient,
  producer: Producer,
  tracer: Tracer,
): Promise<void> {
  return tracer.with(`Process /r/${subreddit}`, async (ctx) => {
    try {
      const posts = await fetchThreadsFromReddit(subreddit, redditClient, tracer);

      if (posts.length === 0) {
        ctx.log.info({ subreddit }, 'No threads found');
        return;
      }

      const newPosts = await findNewThreads(posts, db, tracer);

      if (newPosts.length === 0) {
        return;
      }

      await processNewThreads(newPosts, db, producer, tracer);
    } catch (error) {
      ctx.log.error({ error, subreddit }, `Failed to fetch threads from /r/${subreddit}`);
      throw error;
    }
  });
}

export function makeThreadFetcherService(opts: MakeThreadFetcherServiceOpts) {
  const { db, tracer, producer } = opts;
  const redditClient = makeRedditClient();

  return {
    async fetchThreads() {
      for (const subreddit of SUBREDDITS) {
        await processSubreddit(subreddit, redditClient, db, producer, tracer);
      }
    },
  };
}
