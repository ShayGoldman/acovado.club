import * as D from 'drizzle-orm/pg-core';

export const acovado = D.pgSchema('acovado');

export const inferenceLogs = acovado.table('inference_logs', {
  id: D.uuid('id').primaryKey().defaultRandom(),
  name: D.text('name'),
  model: D.text('model').notNull(),
  config: D.jsonb('config'),
  prompt: D.text('prompt').notNull(),
  response: D.jsonb('response'),
  durationMs: D.numeric('duration_ms', { precision: 10, scale: 2 }).notNull(),
  status: D.text('status', { enum: ['success', 'error'] }).notNull(),
  error: D.text('error'),
  retryCount: D.integer('retry_count').notNull().default(0),
  metadata: D.jsonb('metadata'),
  createdAt: D.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sources = acovado.table(
  'sources',
  {
    id: D.uuid('id').primaryKey().defaultRandom(),
    kind: D.text('kind', { enum: ['reddit', 'youtube'] }).notNull(),
    externalId: D.text('external_id').notNull(),
    displayName: D.text('display_name').notNull(),
    config: D.jsonb('config'),
    active: D.boolean('active').notNull().default(true),
    createdAt: D.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [D.unique('sources_kind_external_id_unique').on(t.kind, t.externalId)],
);

export const tickers = acovado.table('tickers', {
  id: D.uuid('id').primaryKey().defaultRandom(),
  symbol: D.text('symbol').notNull().unique(),
  companyName: D.text('company_name').notNull(),
  exchange: D.text('exchange'),
  cik: D.text('cik'),
  createdAt: D.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const contentItems = acovado.table(
  'content_items',
  {
    id: D.uuid('id').primaryKey().defaultRandom(),
    sourceId: D.uuid('source_id')
      .notNull()
      .references(() => sources.id),
    externalId: D.text('external_id').notNull(),
    title: D.text('title'),
    body: D.text('body'),
    url: D.text('url').notNull(),
    publishedAt: D.timestamp('published_at', { withTimezone: true }),
    processedAt: D.timestamp('processed_at', { withTimezone: true }),
    createdAt: D.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    D.unique('content_items_source_external_unique').on(t.sourceId, t.externalId),
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
    tickerSymbol: D.text('ticker_symbol')
      .notNull()
      .references(() => tickers.symbol),
    confidence: D.numeric('confidence', { precision: 4, scale: 3 }).notNull(),
    isExplicit: D.boolean('is_explicit').notNull(),
    rawContext: D.text('raw_context'),
    mentionedAt: D.timestamp('mentioned_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: D.timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    D.index('mentions_ticker_symbol_idx').on(t.tickerSymbol),
    D.index('mentions_mentioned_at_idx').on(t.mentionedAt),
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
