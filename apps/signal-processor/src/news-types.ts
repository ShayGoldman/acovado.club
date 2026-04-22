/** Payload published by apps/news-worker for each collected article. */
export interface NewsArticleCollectedPayload {
  /** nanoid — unique per published event */
  id: string;
  /** acovado.sources UUID for the outlet row */
  sourceId: string;
  /** Canonical article URL — dedup key within source */
  externalId: string;
  title: string;
  /** Extracted article text, truncated to 8000 chars by the worker */
  body: string;
  /** Canonical article URL (identical to externalId for news) */
  url: string;
  /** ISO 8601 */
  publishedAt: string;
}
