/** Payload published by apps/youtube-worker for each collected video. */
export interface YouTubeVideoCollectedPayload {
  /** nanoid — unique per published event */
  id: string;
  /** acovado.sources UUID for the YouTube channel row */
  sourceId: string;
  /** YouTube channel ID */
  channelId: string;
  /** YouTube video ID */
  externalId: string;
  title: string;
  /** Video description, truncated to 2000 chars by the worker */
  description: string;
  /** https://www.youtube.com/watch?v={externalId} */
  url: string;
  /** ISO 8601 */
  publishedAt: string;
}
