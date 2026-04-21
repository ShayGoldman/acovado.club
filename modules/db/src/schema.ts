import { sql } from 'drizzle-orm';
import * as D from 'drizzle-orm/pg-core';

export const acovado = D.pgSchema('acovado');

// ---------------------------------------------------------------------------
// sources — data sources (subreddits, youtube channels, etc.)
// ---------------------------------------------------------------------------
export const sources = acovado.table(
  'sources',
  (c) => ({
    id: c.uuid().primaryKey().default(sql`gen_random_uuid()`),
    /** 'reddit' | 'youtube' | 'news' | future kinds */
    kind: c.varchar('kind', { length: 32 }).notNull(),
    /** subreddit name, YouTube channel ID, or news outlet slug */
    externalId: c.varchar('external_id', { length: 256 }).notNull(),
    displayName: c.varchar('display_name', { length: 256 }),
    active: c.boolean().notNull().default(true),
    /** Per-source poll cadence override in ms. NULL = use app default (10 min). */
    pollIntervalMs: c.integer('poll_interval_ms'),
    createdAt: c.timestamp('created_at').defaultNow().notNull(),
  }),
  (t) => [D.unique().on(t.kind, t.externalId)],
);

// ---------------------------------------------------------------------------
// tickers — known ticker symbols (populated by extractor on first mention)
// ---------------------------------------------------------------------------
export const tickers = acovado.table('tickers', (c) => ({
  symbol: c.varchar('symbol', { length: 16 }).primaryKey(),
  displayName: c.varchar('display_name', { length: 128 }),
  createdAt: c.timestamp('created_at').defaultNow().notNull(),
}));

// ---------------------------------------------------------------------------
// content_items — collected posts and videos (one row per external item)
// ---------------------------------------------------------------------------
export const contentItems = acovado.table(
  'content_items',
  (c) => ({
    id: c.uuid().primaryKey().default(sql`gen_random_uuid()`),
    sourceId: c
      .uuid('source_id')
      .notNull()
      .references(() => sources.id),
    externalId: c.varchar('external_id', { length: 256 }).notNull(),
    title: c.text('title').notNull(),
    /** Body text (reddit: selftext, youtube: description). Null for link posts. */
    body: c.text('body'),
    url: c.text('url').notNull(),
    publishedAt: c.timestamp('published_at').notNull(),
    /** Set when ticker extraction completes; null means not yet processed. */
    processedAt: c.timestamp('processed_at'),
    createdAt: c.timestamp('created_at').defaultNow().notNull(),
  }),
  (t) => [D.unique().on(t.sourceId, t.externalId)],
);

// ---------------------------------------------------------------------------
// mentions — ticker symbols extracted from content items
// ---------------------------------------------------------------------------
export const mentions = acovado.table('mentions', (c) => ({
  id: c.uuid().primaryKey().default(sql`gen_random_uuid()`),
  contentItemId: c
    .uuid('content_item_id')
    .notNull()
    .references(() => contentItems.id),
  tickerSymbol: c.varchar('ticker_symbol', { length: 16 }).notNull(),
  /** Decimal confidence score stored as string (e.g. "0.92") */
  confidence: c.varchar('confidence', { length: 16 }).notNull(),
  isExplicit: c.boolean('is_explicit').notNull().default(false),
  rawContext: c.text('raw_context'),
  createdAt: c.timestamp('created_at').defaultNow().notNull(),
}));

// ---------------------------------------------------------------------------
// inference_logs — LLM invocation audit trail (used by @modules/inference)
// ---------------------------------------------------------------------------
export const inferenceLogs = acovado.table('inference_logs', (c) => ({
  id: c.uuid().primaryKey().default(sql`gen_random_uuid()`),
  name: c.varchar('name', { length: 256 }),
  model: c.varchar('model', { length: 128 }).notNull(),
  config: c.jsonb('config'),
  prompt: c.text('prompt').notNull(),
  response: c.text('response'),
  /** Duration in milliseconds, stored as string to avoid float precision loss */
  durationMs: c.varchar('duration_ms', { length: 32 }).notNull(),
  /** 'success' | 'error' */
  status: c.varchar('status', { length: 16 }).notNull(),
  error: c.text('error'),
  retryCount: c.integer('retry_count').notNull().default(0),
  metadata: c.jsonb('metadata'),
  createdAt: c.timestamp('created_at').defaultNow().notNull(),
}));

// ---------------------------------------------------------------------------
// news_source_configs — seed URL configuration for news sources
// ---------------------------------------------------------------------------
export const newsSourceConfigs = acovado.table(
  'news_source_configs',
  (c) => ({
    id: c.uuid().primaryKey().default(sql`gen_random_uuid()`),
    sourceId: c
      .uuid('source_id')
      .notNull()
      .references(() => sources.id),
    /** Landing page URL to crawl for article links. */
    seedUrl: c.text('seed_url').notNull(),
    active: c.boolean().notNull().default(true),
    createdAt: c.timestamp('created_at').defaultNow().notNull(),
  }),
  (t) => [D.unique().on(t.sourceId, t.seedUrl)],
);

// ---------------------------------------------------------------------------
// seen_urls — persistent URL de-dup store for news discovery
// ---------------------------------------------------------------------------
export const seenUrls = acovado.table(
  'seen_urls',
  (c) => ({
    /** SHA-256 hex of normalized URL — O(1) dedup lookup. */
    urlHash: c.varchar('url_hash', { length: 64 }).primaryKey(),
    /** Full normalized URL — kept for debug/audit. */
    url: c.text('url').notNull(),
    /** Source that first discovered this URL — always known at insert time. */
    discoveredBySourceId: c
      .uuid('discovered_by_source_id')
      .notNull()
      .references(() => sources.id),
    firstSeenAt: c.timestamp('first_seen_at').defaultNow().notNull(),
  }),
  (t) => [D.index('seen_urls_first_seen_at_idx').on(t.firstSeenAt)],
);

// ---------------------------------------------------------------------------
// news_articles — full-content fetch results (Playwright extracted body)
// ---------------------------------------------------------------------------
export const newsArticles = acovado.table(
  'news_articles',
  (c) => ({
    id: c.uuid().primaryKey().default(sql`gen_random_uuid()`),
    sourceId: c
      .uuid('source_id')
      .notNull()
      .references(() => sources.id),
    url: c.text('url').notNull(),
    title: c.text('title'),
    extractedBody: c.text('extracted_body'),
    /** SHA-256 hex of rendered HTML — varchar(64) matching seen_urls.url_hash convention.
     *  NOT unique: same content may appear at different URLs. Unique constraint is on url only. */
    htmlHash: c.varchar('html_hash', { length: 64 }),
    /** 'success' | 'extract_failed' | 'error' — varchar(32) matching inference_logs.status convention */
    fetchStatus: c.varchar('fetch_status', { length: 32 }).notNull(),
    errorMessage: c.text('error_message'),
    fetchedAt: c.timestamp('fetched_at', { withTimezone: true }),
    createdAt: c.timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  }),
  (t) => [D.unique().on(t.url)],
);

// ---------------------------------------------------------------------------
// Barrel export expected by the rest of the codebase via `import schema`
// ---------------------------------------------------------------------------
const schema = {
  sources,
  tickers,
  contentItems,
  mentions,
  inferenceLogs,
  newsSourceConfigs,
  seenUrls,
  newsArticles,
};

export { schema };
export default schema;
