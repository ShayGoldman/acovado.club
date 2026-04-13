import type { Logger } from '@modules/logger';

/** Raw snippet returned from the YouTube RSS feed */
export interface VideoSnippet {
  videoId: string;
  title: string;
  /** Empty string — descriptions are not included in the RSS feed */
  description: string;
  /** ISO 8601 */
  publishedAt: string;
  channelId: string;
}

export interface FetchRecentVideosOpts {
  channelId: string;
  maxResults: number;
  /** Only return videos published after this date */
  publishedAfter?: Date;
}

export interface MakeYouTubeClientOpts {
  logger: Logger;
}

export type YouTubeClient = ReturnType<typeof makeYouTubeClient>;

export function makeYouTubeClient({ logger }: MakeYouTubeClientOpts) {
  /**
   * Fetches recent videos from the YouTube Atom RSS feed for a channel.
   * No API key required. Filters client-side by publishedAfter when set.
   */
  async function fetchRecentVideos(opts: FetchRecentVideosOpts): Promise<VideoSnippet[]> {
    const { channelId, maxResults, publishedAfter } = opts;

    const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    logger.debug({ channelId, maxResults }, 'yt.client.rss.fetch');

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`RSS fetch failed: ${res.status} ${res.statusText}`);
    }

    const xmlText = await res.text();

    // Extract <entry> blocks from the Atom feed using regex — avoids DOMParser
    // which is unavailable in Bun's Node-compatible runtime.
    const entryPattern = /<entry>([\s\S]*?)<\/entry>/g;
    const tagText = (block: string, tag: string): string => {
      const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
      return m?.[1]?.trim() ?? '';
    };

    const entries: RegExpMatchArray[] = [];
    for (;;) {
      const m = entryPattern.exec(xmlText);
      if (m === null) break;
      entries.push(m);
    }

    return entries
      .map((match) => {
        const block = match[1] ?? '';
        const videoId = tagText(block, 'yt:videoId');
        const title = tagText(block, 'title');
        const published = tagText(block, 'published');
        const entryChannelId = tagText(block, 'yt:channelId') || channelId;
        return {
          videoId,
          title,
          description: '',
          publishedAt: published,
          channelId: entryChannelId,
        };
      })
      .filter(
        (v) => v.videoId && (!publishedAfter || new Date(v.publishedAt) > publishedAfter),
      )
      .slice(0, maxResults);
  }

  return { fetchRecentVideos };
}
