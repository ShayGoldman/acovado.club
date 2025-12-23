import { relations, sql } from 'drizzle-orm';
import * as D from 'drizzle-orm/pg-core';

export const acovado = D.pgSchema('acovado');
export const metabase = D.pgSchema('metabase');

export const redditStatusEnum = acovado.enum('reddit_status', [
  'pending',
  'processed',
  'error',
]);

export const inferenceStatusEnum = acovado.enum('inference_status', ['success', 'error']);

export const gradingStatusEnum = acovado.enum('grading_status', ['success', 'error']);

export const trackedSubredditStatusEnum = acovado.enum('tracked_subreddit_status', [
  'enabled',
  'disabled',
  'ignored',
]);

export const watchLists = acovado.table('watch_lists', (c) => ({
  id: c.uuid().primaryKey().default(sql`gen_random_uuid()`),
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

export const tickers = acovado.table('tickers', (c) => ({
  id: c.uuid().primaryKey().default(sql`gen_random_uuid()`),
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

export const watchListToTickers = acovado.table(
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

export const collections = acovado.table('collections', (c) => ({
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

export const signalMetrics = acovado.table('signal_metrics', (c) => ({
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

export const kvStore = acovado.table('kv_store', (c) => ({
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

export const stories = acovado.table('stories', (c) => ({
  id: c.serial().primaryKey(),
  type: c.varchar('type', { length: 128 }).notNull(),
  ticker: c.uuid('ticker_id').notNull(),
  signal: c.integer('signal_id').notNull(),
  change: c.doublePrecision('change').notNull(),
  createdAt: c.timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
}));

export const redditThreads = acovado.table('reddit_threads', (c) => ({
  id: c.serial().primaryKey(),
  redditId: c.varchar('reddit_id', { length: 64 }).notNull().unique(),
  subreddit: c.varchar('subreddit', { length: 128 }).notNull(),
  title: c.varchar('title', { length: 512 }).notNull(),
  author: c.varchar('author', { length: 128 }).notNull(),
  selftext: c.text('selftext').notNull(),
  url: c.varchar('url', { length: 512 }).notNull(),
  permalink: c.varchar('permalink', { length: 512 }).notNull(),
  score: c.integer('score').notNull(),
  numComments: c.integer('num_comments').notNull(),
  createdUtc: c.timestamp('created_utc', { mode: 'string' }).notNull(),
  status: redditStatusEnum('status').notNull(),
  data: c.jsonb('data').notNull(),
  lastReplyFetchAt: c.timestamp('last_reply_fetch_at', { mode: 'string' }),
  createdAt: c.timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
  updatedAt: c
    .timestamp('updated_at', { mode: 'string' })
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => new Date().toISOString()),
}));

export const redditReplies = acovado.table('reddit_replies', (c) => ({
  id: c.serial().primaryKey(),
  redditId: c.varchar('reddit_id', { length: 64 }).notNull().unique(),
  threadId: c
    .integer('thread_id')
    .notNull()
    .references(() => redditThreads.id, { onDelete: 'cascade' }),
  parentRedditId: c.varchar('parent_reddit_id', { length: 64 }),
  author: c.varchar('author', { length: 128 }).notNull(),
  body: c.text('body').notNull(),
  score: c.integer('score').notNull(),
  createdUtc: c.timestamp('created_utc', { mode: 'string' }).notNull(),
  status: redditStatusEnum('status').notNull(),
  data: c.jsonb('data').notNull(),
  createdAt: c.timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
  updatedAt: c
    .timestamp('updated_at', { mode: 'string' })
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => new Date().toISOString()),
}));

export const inferenceLogs = acovado.table('inference_logs', (c) => ({
  id: c.serial().primaryKey(),
  name: c.varchar('name', { length: 256 }),
  model: c.varchar('model', { length: 128 }).notNull(),
  config: c.jsonb('config').notNull(),
  prompt: c.jsonb('prompt').notNull(),
  response: c.jsonb('response'),
  durationMs: c.numeric('duration_ms', { precision: 10, scale: 2 }).notNull(),
  status: inferenceStatusEnum('status').notNull(),
  error: c.text('error'),
  retryCount: c.integer('retry_count').notNull().default(0),
  metadata: c.jsonb('metadata'),
  createdAt: c.timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
}));

export const gradingLogs = acovado.table('grading_logs', (c) => ({
  id: c.serial().primaryKey(),
  inferenceLogId: c
    .integer('inference_log_id')
    .notNull()
    .references(() => inferenceLogs.id, { onDelete: 'cascade' }),
  graderModel: c.varchar('grader_model', { length: 128 }).notNull(),
  graderConfig: c.jsonb('grader_config').notNull(),
  graderPrompt: c.jsonb('grader_prompt').notNull(),
  confidence: c.varchar('confidence', { length: 32 }),
  passed: c.boolean('passed'),
  feedback: c.text('feedback'),
  reasoning: c.text('reasoning'),
  durationMs: c.numeric('duration_ms', { precision: 10, scale: 2 }).notNull(),
  status: gradingStatusEnum('status').notNull(),
  error: c.text('error'),
  createdAt: c.timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
}));

export const trackedSubreddits = acovado.table('tracked_subreddits', (c) => ({
  id: c.serial().primaryKey(),
  name: c.varchar('name', { length: 128 }).notNull().unique(),
  status: trackedSubredditStatusEnum('status').notNull().default('disabled'),
  createdAt: c.timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
  updatedAt: c
    .timestamp('updated_at', { mode: 'string' })
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => new Date().toISOString()),
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
  redditThreads,
  redditReplies,
  inferenceLogs,
  gradingLogs,
  trackedSubreddits,
};

// required so client is easily created
export default schema;
