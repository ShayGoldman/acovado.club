import { and, eq, schema } from '@modules/db';
import type { DBClient } from '@modules/db';
import type { Producer } from '@modules/events';
import { makeId } from '@modules/ids';
import type { Logger } from '@modules/logger';
import { makeRedditClient } from '@modules/reddit-client';
import type { Tracer } from '@modules/tracing';
import type { RedditPostCollectedPayload } from './types';

export interface MakePollerOpts {
  db: DBClient;
  producer: Producer;
  logger: Logger;
  tracer: Tracer;
  fetchLimit: number;
}

export function makePoller({ db, producer, logger, tracer, fetchLimit }: MakePollerOpts) {
  const redditClient = makeRedditClient({ logger });

  async function fetchActiveSources() {
    return db
      .select()
      .from(schema.sources)
      .where(and(eq(schema.sources.kind, 'reddit'), eq(schema.sources.active, true)));
  }

  async function fetchHotPosts(
    sourceId: string,
    subreddit: string,
  ): Promise<RedditPostCollectedPayload[]> {
    return tracer.with(`reddit.fetch ${subreddit}`, async (ctx) => {
      ctx.annotate('subreddit', subreddit);
      const threads = await redditClient.fetchSubredditThreads(subreddit, fetchLimit);
      ctx.annotate('post_count', threads.length);
      return threads.map((thread) => ({
        id: makeId(),
        sourceId,
        subreddit,
        externalId: thread.id,
        title: thread.title,
        body: thread.selftext,
        url: thread.url,
        permalink: thread.permalink,
        score: thread.score,
        numComments: thread.num_comments,
        publishedAt: new Date(thread.created_utc * 1000).toISOString(),
      }));
    });
  }

  /**
   * One full poll tick. Per-subreddit errors are caught and logged —
   * a single failing subreddit does not abort the rest.
   */
  async function runOnce(): Promise<void> {
    const sources = await fetchActiveSources();
    logger.info({ count: sources.length }, 'poll.tick.start');

    await tracer.with('cron.tick', async (ctx) => {
      ctx.annotate('subreddit_count', sources.length);

      for (const source of sources) {
        try {
          const payloads = await fetchHotPosts(source.id, source.externalId);
          await producer.send('reddit', 'post.collected', payloads);
          logger.info(
            { subreddit: source.externalId, count: payloads.length },
            'poll.published',
          );
        } catch (err) {
          logger.error({ err, subreddit: source.externalId }, 'poll.subreddit.error');
        }
      }
    });

    logger.info({ count: sources.length }, 'poll.tick.done');
  }

  return { runOnce };
}
