/** Payload published to youtube.exchange with routing key video.collected */
export interface YouTubeVideoCollectedPayload {
  /** nanoid */
  id: string;
  /** acovado.sources UUID */
  sourceId: string;
  /** YouTube channel ID */
  channelId: string;
  /** YouTube video ID */
  externalId: string;
  title: string;
  /** Truncated to 2000 chars */
  description: string;
  /** https://www.youtube.com/watch?v={externalId} */
  url: string;
  /** ISO 8601 */
  publishedAt: string;
}

/** A YouTube channel source with its resolved uploads playlist ID */
export interface ResolvedChannel {
  /** acovado.sources UUID */
  sourceId: string;
  /** YouTube channel ID */
  channelId: string;
  /** YouTube uploads playlist ID (from channels.list at startup) */
  uploadPlaylistId: string;
}
