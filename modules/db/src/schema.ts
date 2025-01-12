import { sql, relations } from 'drizzle-orm';
import * as D from 'drizzle-orm/pg-core';

export const finance = D.pgSchema('finance');
export const metabase = D.pgSchema('metabase');

export const watchLists = finance.table('watch_lists', (c) => ({
  id: c
    .uuid()
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: c.varchar('name', { length: 128 }).notNull(),
  createdAt: c.timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
  updatedAt: c
    .timestamp('updated_at', { mode: 'string' })
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => new Date().toISOString()),
}));

export const watchListsRelations = relations(watchLists, ({ many }) => ({
  tickers: many(watchListToTickers),
}));

export const tickers = finance.table('tickers', (c) => ({
  id: c
    .uuid()
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: c.varchar('name', { length: 64 }).notNull(),
  symbol: c.varchar('symbol', { length: 8 }).notNull().unique(),
  createdAt: c.timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
  updatedAt: c
    .timestamp('updated_at', { mode: 'string' })
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => new Date().toISOString()),
}));

export const tickersRelations = relations(tickers, ({ many }) => ({
  watchLists: many(watchListToTickers),
}));

export const watchListToTickers = finance.table(
  'watch_list_to_tickers',
  (c) => ({
    watchListId: c
      .uuid('watch_list_id')
      .notNull()
      .references(() => watchLists.id, { onDelete: 'cascade' }),
    tickerId: c
      .uuid('ticker_id')
      .notNull()
      .references(() => tickers.id, { onDelete: 'cascade' }),
    createdAt: c.timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
  }),
  (t) => ({
    pk: D.primaryKey({ columns: [t.watchListId, t.tickerId] }),
  }),
);

export const watchListToTickersRelations = relations(watchListToTickers, ({ one }) => ({
  ticker: one(tickers, {
    fields: [watchListToTickers.tickerId],
    references: [tickers.id],
    relationName: 'ticker',
  }),
  watchList: one(watchLists, {
    fields: [watchListToTickers.watchListId],
    references: [watchLists.id],
    relationName: 'watchList',
  }),
}));

export const collections = finance.table('collections', (c) => ({
  id: c.serial().primaryKey(),
  type: c.varchar('type', { length: 64 }).notNull(),
  status: c.varchar('status', { length: 64 }).notNull(),
  data: c.jsonb('data').notNull(),
  createdAt: c.timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
  updatedAt: c
    .timestamp('updated_at', { mode: 'string' })
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => new Date().toISOString()),
}));

export const signalMetrics = finance.table('signal_metrics', (c) => ({
  id: c.serial().primaryKey(),
  tickerId: c
    .uuid('ticker_id')
    .notNull()
    .references(() => tickers.id, { onDelete: 'cascade' }),
  collectionId: c
    .integer('collection_id')
    .notNull()
    .references(() => collections.id, { onDelete: 'cascade' }),
  type: c.varchar('type', { length: 128 }).notNull(),
  metric: c.numeric('metric', { precision: 15, scale: 4 }).notNull(),
  createdAt: c.timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
}));

export const kvStore = finance.table('kv_store', (c) => ({
  id: c.serial().primaryKey(),
  key: c.varchar('key', { length: 128 }).notNull().unique(),
  value: c.varchar('value', { length: 256 }).notNull(),
  createdAt: c.timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
  updatedAt: c
    .timestamp('updated_at', { mode: 'string' })
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => new Date().toISOString()),
}));

export const stories = finance.table('stories', (c) => ({
  id: c.serial().primaryKey(),
  type: c.varchar('type', { length: 128 }).notNull(),
  ticker: c.uuid('ticker_id').notNull(),
  signal: c.integer('signal_id').notNull(),
  change: c.doublePrecision('change').notNull(),
  createdAt: c.timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
}));

export const bleh = finance.table('stories_bleh', (c) => ({
  id: c.serial().primaryKey(),
  type: c.varchar('type', { length: 128 }).notNull(),
  ticker: c.uuid('ticker_id').notNull(),
  signal: c.integer('signal_id').notNull(),
  change: c.doublePrecision('change').notNull(),
  createdAt: c.timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
}));

export const bbbb = finance.table('bbbbbbbb', (c) => ({
  id: c.serial().primaryKey(),
  type: c.varchar('type', { length: 128 }).notNull(),
  ticker: c.uuid('ticker_id').notNull(),
  signal: c.integer('signal_id').notNull(),
  change: c.doublePrecision('change').notNull(),
  createdAt: c.timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
}));

export const schema = {
  watchLists,
  watchListsRelations,
  tickers,
  tickersRelations,
  watchListToTickers,
  watchListToTickersRelations,
  collections,
  signalMetrics,
  kvStore,
  stories,
};

// required so client is easily created
export default schema;
