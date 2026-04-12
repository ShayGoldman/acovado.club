import { makeId } from '@modules/ids';
import type { Logger } from '@modules/logger';
import type { Producer } from '@modules/events';
import type { YouTubeClient } from './youtube-client';
import type { Source, YouTubeVideoCollectedPayload } from './types';

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
  youtubeClient: YouTubeClient;
  logger: Logger;
  fetchLimit: number;
}

export type Poller = ReturnType<typeof makePoller>;

export function makePoller({
  db,
  producer,
  youtubeClient,
  logger,
  fetchLimit,
}: MakePollerOpts) {
  async function fetchActiveSources(): Promise<Source[]> {
    const rows = await db.execute(
      `SELECT id, external_id FROM acovado.sources WHERE kind = 'youtube' AND active = true`,
    );
    return rows.map((row) => {
      const r = row as { id: string; external_id: string };
      return { id: r.id, externalId: r.external_id };
    });
  }

  /**
   * Returns the most recent published_at date stored for a source, or undefined
   * on the first run (no rows yet). Used to drive incremental fetching.
   */
  async function getCheckpoint(sourceId: string): Promise<Date | undefined> {
    // sourceId is a UUID from our own DB — not from external input.
    const rows = await db.execute(
      `SELECT MAX(published_at) AS max FROM acovado.content_items WHERE source_id = '${sourceId}'`,
    );
    const max = (rows[0] as { max: string | null } | undefined)?.max;
    return max ? new Date(max as string) : undefined;
  }

  async function pollChannel(source: Source): Promise<void> {
    const publishedAfter = await getCheckpoint(source.id);
    const videos = await youtubeClient.fetchRecentVideos({
      channelId: source.externalId,
      maxResults: fetchLimit,
      ...(publishedAfter ? { publishedAfter } : {}),
    });

    if (videos.length === 0) {
      logger.debug({ channelId: source.externalId }, 'yt.poll.no_new_videos');
      return;
    }

    const payloads: YouTubeVideoCollectedPayload[] = videos.map((v) => ({
      id: makeId(),
      sourceId: source.id,
      channelId: v.channelId,
      externalId: v.videoId,
      title: v.title,
      description: v.description,
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
      publishedAt: v.publishedAt,
    }));

    await producer.send('youtube', 'video.collected', payloads);
    logger.info(
      { channelId: source.externalId, count: payloads.length },
      'yt.poll.published',
    );
  }

  /** Polls all active YouTube sources; isolates errors per channel. */
  async function runOnce(): Promise<void> {
    const sources = await fetchActiveSources();
    logger.info({ count: sources.length }, 'yt.tick.start');
    for (const source of sources) {
      try {
        await pollChannel(source);
      } catch (err) {
        logger.error({ err, channelId: source.externalId }, 'yt.poll.channel.error');
      }
    }
    logger.info({ count: sources.length }, 'yt.tick.done');
  }

  return { runOnce };
}
