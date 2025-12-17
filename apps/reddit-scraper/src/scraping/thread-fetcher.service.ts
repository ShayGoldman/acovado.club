import type { DBClient } from '@modules/db';
import { makeRedditThread, schema } from '@modules/db';
import { makeEvent, type Producer } from '@modules/events';
import type { Tracer } from '@modules/tracing';
import { inArray } from 'drizzle-orm';
import { makeRedditClient } from './reddit-client';

const SUBREDDITS = ['ValueInvesting'] as const;

export interface MakeThreadFetcherServiceOpts {
  db: DBClient;
  tracer: Tracer;
  producer: Producer;
}

export function makeThreadFetcherService(opts: MakeThreadFetcherServiceOpts) {
  const { db, tracer, producer } = opts;
  const redditClient = makeRedditClient();

  return {
    async fetchThreads() {
      await tracer.with('Fetch Reddit threads', async (c) => {
        for (const subreddit of SUBREDDITS) {
          await c.with(`Fetch threads from r/${subreddit}`, async (ctx) => {
            try {
              // Fetch threads from Reddit
              const posts = await redditClient.fetchSubredditPosts(subreddit);
              ctx.log.info(
                { subreddit, count: posts.length },
                `Fetched ${posts.length} threads from r/${subreddit}`,
              );

              if (posts.length === 0) {
                return;
              }

              // Check which threads already exist (deduplication)
              const redditIds = posts.map((p) => p.id);
              const existingThreads = await db
                .select({ redditId: schema.redditThreads.redditId })
                .from(schema.redditThreads)
                .where(inArray(schema.redditThreads.redditId, redditIds));

              const existingRedditIds = new Set(existingThreads.map((t) => t.redditId));
              const newPosts = posts.filter((p) => !existingRedditIds.has(p.id));

              ctx.log.info(
                { subreddit, new: newPosts.length, existing: existingRedditIds.size },
                `Found ${newPosts.length} new threads, ${existingRedditIds.size} already exist`,
              );

              if (newPosts.length === 0) {
                return;
              }

              // Insert new threads
              for (const post of newPosts) {
                await ctx.with(`Save thread ${post.id}`, async (saveCtx) => {
                  const [insertedThread] = await db
                    .insert(schema.redditThreads)
                    .values(
                      makeRedditThread({
                        redditId: post.id,
                        subreddit: post.subreddit,
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

                  saveCtx.log.debug(
                    { threadId: insertedThread.id, redditId: post.id },
                    'Thread saved to database',
                  );

                  // Emit lightweight event with only metadata
                  const event = makeEvent('reddit-thread', 'fetched', {
                    id: insertedThread.id,
                    reddit_id: insertedThread.redditId,
                    subreddit: insertedThread.subreddit,
                  });

                  await producer.send('reddit', 'reddit.thread.fetched', event, {
                    baggage: {
                      'thread.id': insertedThread.id.toString(),
                      'thread.reddit_id': insertedThread.redditId,
                    },
                  });

                  saveCtx.log.debug(
                    { threadId: insertedThread.id },
                    'Event emitted for thread',
                  );
                });
              }
            } catch (error) {
              ctx.log.error(
                { error, subreddit },
                `Failed to fetch threads from r/${subreddit}`,
              );
              throw error;
            }
          });
        }
      });
    },
  };
}
