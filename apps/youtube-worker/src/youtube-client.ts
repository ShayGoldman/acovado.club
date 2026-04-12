import type { Logger } from '@modules/logger';

/** Raw snippet returned from playlistItems.list */
export interface VideoSnippet {
  videoId: string;
  title: string;
  /** Truncated to 2000 chars */
  description: string;
  /** ISO 8601 */
  publishedAt: string;
  channelId: string;
}

export interface FetchRecentVideosOpts {
  uploadPlaylistId: string;
  maxResults: number;
  /** Only return videos published after this date */
  publishedAfter?: Date;
}

export interface MakeYouTubeClientOpts {
  apiKey: string;
  logger: Logger;
}

export type YouTubeClient = ReturnType<typeof makeYouTubeClient>;

export function makeYouTubeClient({ apiKey, logger }: MakeYouTubeClientOpts) {
  const BASE = 'https://www.googleapis.com/youtube/v3';

  /**
   * Fetches the uploads playlist ID for a channel via channels.list.
   * Costs 1 quota unit per call; called once at startup and cached.
   */
  async function fetchUploadPlaylistId(channelId: string): Promise<string> {
    const url = new URL(`${BASE}/channels`);
    url.searchParams.set('part', 'contentDetails');
    url.searchParams.set('id', channelId);
    url.searchParams.set('key', apiKey);

    logger.debug({ channelId }, 'yt.client.channels.list');
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`channels.list failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as any;
    const playlistId = data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!playlistId) {
      throw new Error(`No uploads playlist found for channel ${channelId}`);
    }
    return playlistId as string;
  }

  /**
   * Fetches recent videos from an uploads playlist via playlistItems.list.
   * Costs 1 quota unit per call. Filters client-side by publishedAfter when set.
   */
  async function fetchRecentVideos(opts: FetchRecentVideosOpts): Promise<VideoSnippet[]> {
    const { uploadPlaylistId, maxResults, publishedAfter } = opts;

    const url = new URL(`${BASE}/playlistItems`);
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('playlistId', uploadPlaylistId);
    url.searchParams.set('maxResults', String(maxResults));
    url.searchParams.set('key', apiKey);

    logger.debug({ uploadPlaylistId, maxResults }, 'yt.client.playlistItems.list');
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`playlistItems.list failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as any;
    const items: any[] = data.items ?? [];

    return items
      .filter(
        (item) => !publishedAfter || new Date(item.snippet.publishedAt) > publishedAfter,
      )
      .map((item) => ({
        videoId: item.snippet.resourceId.videoId as string,
        title: item.snippet.title as string,
        description: ((item.snippet.description as string) ?? '').slice(0, 2000),
        publishedAt: item.snippet.publishedAt as string,
        channelId: item.snippet.channelId as string,
      }));
  }

  return { fetchUploadPlaylistId, fetchRecentVideos };
}
