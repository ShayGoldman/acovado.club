import * as D from 'drizzle-orm/pg-core';

export const acovado = D.pgSchema('acovado');

export const inferenceLogs = acovado.table('inference_logs', {
  id: D.uuid('id').primaryKey().defaultRandom(),
  name: D.text('name'),
  model: D.text('model').notNull(),
  config: D.jsonb('config'),
  prompt: D.text('prompt').notNull(),
  response: D.jsonb('response'),
  durationMs: D.numeric('duration_ms').notNull(),
  status: D.text('status', { enum: ['success', 'error'] }).notNull(),
  error: D.text('error'),
  retryCount: D.integer('retry_count').notNull().default(0),
  metadata: D.jsonb('metadata'),
  createdAt: D.timestamp('created_at').notNull().defaultNow(),
});

export const sources = acovado.table(
  'sources',
  {
    id: D.uuid('id').primaryKey().defaultRandom(),
    kind: D.text('kind', { enum: ['subreddit', 'youtube_channel'] }).notNull(),
    identifier: D.text('identifier').notNull(),
    name: D.text('name'),
    active: D.boolean('active').notNull().default(true),
    metadata: D.jsonb('metadata'),
    createdAt: D.timestamp('created_at').notNull().defaultNow(),
    updatedAt: D.timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [D.uniqueIndex('sources_kind_identifier_idx').on(t.kind, t.identifier)],
);

export const tickers = acovado.table(
  'tickers',
  {
    id: D.uuid('id').primaryKey().defaultRandom(),
    symbol: D.text('symbol').notNull(),
    name: D.text('name').notNull(),
    cik: D.text('cik'),
    exchange: D.text('exchange'),
    active: D.boolean('active').notNull().default(true),
    createdAt: D.timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [D.uniqueIndex('tickers_symbol_idx').on(t.symbol)],
);

export const contentItems = acovado.table(
  'content_items',
  {
    id: D.uuid('id').primaryKey().defaultRandom(),
    sourceId: D.uuid('source_id')
      .notNull()
      .references(() => sources.id),
    externalId: D.text('external_id').notNull(),
    kind: D.text('kind', {
      enum: ['reddit_post', 'reddit_comment', 'youtube_video', 'youtube_comment'],
    }).notNull(),
    title: D.text('title'),
    body: D.text('body'),
    author: D.text('author'),
    url: D.text('url'),
    score: D.integer('score'),
    publishedAt: D.timestamp('published_at'),
    processedAt: D.timestamp('processed_at'),
    metadata: D.jsonb('metadata'),
    createdAt: D.timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    D.uniqueIndex('content_items_source_external_idx').on(t.sourceId, t.externalId),
    D.index('content_items_source_id_idx').on(t.sourceId),
    D.index('content_items_published_at_idx').on(t.publishedAt),
    D.index('content_items_processed_at_idx').on(t.processedAt),
  ],
);

export const mentions = acovado.table(
  'mentions',
  {
    id: D.uuid('id').primaryKey().defaultRandom(),
    contentItemId: D.uuid('content_item_id')
      .notNull()
      .references(() => contentItems.id),
    tickerId: D.uuid('ticker_id')
      .notNull()
      .references(() => tickers.id),
    confidence: D.numeric('confidence').notNull(),
    isExplicit: D.boolean('is_explicit').notNull(),
    context: D.text('context'),
    extractedAt: D.timestamp('extracted_at').notNull().defaultNow(),
    createdAt: D.timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    D.index('mentions_content_item_id_idx').on(t.contentItemId),
    D.index('mentions_ticker_id_idx').on(t.tickerId),
    D.index('mentions_extracted_at_idx').on(t.extractedAt),
  ],
);

export const schema = {
  inferenceLogs,
  sources,
  tickers,
  contentItems,
  mentions,
};

export default schema;
