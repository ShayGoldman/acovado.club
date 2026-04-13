/** Payload published by apps/reddit-worker for each collected post. */
export interface RedditPostCollectedPayload {
  /** nanoid — unique per published event */
  id: string;
  /** acovado.sources UUID for the subreddit row */
  sourceId: string;
  /** subreddit name, e.g. "wallstreetbets" */
  subreddit: string;
  /** Reddit post id, e.g. "abc123" — maps to RedditThread.id */
  externalId: string;
  title: string;
  /** selftext — empty string if link post */
  body: string;
  /** canonical Reddit URL */
  url: string;
  /** full permalink, e.g. /r/wallstreetbets/comments/abc123/... */
  permalink: string;
  score: number;
  numComments: number;
  /** ISO 8601 */
  publishedAt: string;
}
