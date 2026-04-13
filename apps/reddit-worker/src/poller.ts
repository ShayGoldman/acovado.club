import { makeId } from '@modules/ids';
import type { Producer } from '@modules/events';
import type { Logger } from '@modules/logger';
import type { Tracer } from '@modules/tracing';
import type { RedditClient } from '@modules/reddit-client';
import type { Source, RedditPostCollectedPayload } from './types';

/**
 * Narrow DB interface required by the poller.
 * The real DBClient satisfies this; a mock satisfies it in tests.
 */
export interface PollerDb {
  execute(query: string): Promise<Array<Record<string, unknown>>>;
}

export interface MakePollerOpts {
  db: PollerDb;
  producer: Producer;
  redditClient: RedditClient;
  logger: Logger;
  tracer: Tracer;
  fetchLimit: number;
}

export type Poller = ReturnType<typeof makePoller>;

export function makePoller({
  db,
  producer,
  redditClient,
  logger,
  tracer,
  fetchLimit,
}: MakePollerOpts) {
  async function fetchActiveSources(): Promise<Source[]> {
    const rows = await db.execute(
      `SELECT id, external_id FROM acovado.sources WHERE kind = 'reddit' AND active = true`,
    );
    return rows.map((row) => {
      const r = row as { id: string; external_id: string };
      return { id: r.id, externalId: r.external_id };
    });
  }

  /**
   * Returns the most recent published_at date stored for a source, or undefined
   * on the first run (no rows yet). Used to filter already-processed posts.
   */
  async function getCheckpoint(sourceId: string): Promise<Date | undefined> {
    // sourceId is a UUID from our own DB — not from external input.
    const rows = await db.execute(
      `SELECT MAX(published_at) AS max FROM acovado.content_items WHERE source_id = '${sourceId}'`,
    );
    const max = (rows[0] as { max: string | null } | undefined)?.max;
    return max ? new Date(max as string) : undefined;
  }

  async function pollSubreddit(source: Source): Promise<void> {
    const checkpoint = await tracer.with(
      'reddit.fetch_checkpoint',
      { attributes: { sourceId: source.id } },
      async (ctx) => {
        const result = await getCheckpoint(source.id);
        if (result) {
          ctx.annotate('published_after', result.toISOString());
        }
        return result;
      },
    );

    const threads = await tracer.with(
      'reddit.fetch_threads',
      { attributes: { subreddit: source.externalId } },
      async (ctx) => {
        const result = await redditClient.fetchSubredditThreads(
          source.externalId,
          fetchLimit,
        );
        ctx.annotate('thread_count', result.length);
        return result;
      },
    );

    // Filter out posts already processed (created_utc in seconds → compare with checkpoint)
    const newThreads = checkpoint
      ? threads.filter((t) => t.created_utc * 1000 > checkpoint.getTime())
      : threads;

    if (newThreads.length === 0) {
      logger.debug({ subreddit: source.externalId }, 'reddit.poll.no_new_posts');
      return;
    }

    const payloads: RedditPostCollectedPayload[] = newThreads.map((t) => ({
      id: makeId(),
      sourceId: source.id,
      subreddit: t.subreddit,
      externalId: t.id,
      title: t.title,
      body: t.selftext,
      url: t.url,
      permalink: t.permalink,
      score: t.score,
      numComments: t.num_comments,
      publishedAt: new Date(t.created_utc * 1000).toISOString(),
    }));

    await producer.send('reddit', 'post.collected', payloads);
    logger.info(
      { subreddit: source.externalId, count: payloads.length },
      'reddit.poll.published',
    );
  }

  /** Polls all active Reddit sources; isolates errors per subreddit. */
  async function runOnce(): Promise<void> {
    const sources = await tracer.with('reddit.fetch_sources', async (ctx) => {
      const result = await fetchActiveSources();
      ctx.annotate('source_count', result.length);
      return result;
    });
    logger.info({ count: sources.length }, 'reddit.tick.start');
    for (const source of sources) {
      try {
        await pollSubreddit(source);
      } catch (err) {
        logger.error(
          { err, subreddit: source.externalId },
          'reddit.poll.subreddit.error',
        );
      }
    }
    logger.info({ count: sources.length }, 'reddit.tick.done');
  }

  return { runOnce };
}
