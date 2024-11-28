import * as D from 'drizzle-orm/pg-core';

export const finance = D.pgSchema('finance');

export const tickers = finance.table('tickers', {
  id: D.integer().primaryKey().generatedAlwaysAsIdentity(),
  name: D.varchar('name', { length: 64 }).notNull(),
  symbol: D.varchar('symbol', { length: 8 }).notNull().unique(),
  createdAt: D.timestamp('created_at').defaultNow().notNull(),
  updatedAt: D.timestamp('updated_at')
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => new Date()),
});

// required so client is easily created
export default {
  tickers,
};
