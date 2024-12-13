import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import S from '@/schema';
import Z from 'zod';

const insertWatchListToTickerSchema = createInsertSchema(S.watchListToTickers);

const selectWatchListToTickerSchema = createSelectSchema(S.watchListToTickers);

export type WatchListToTicker = Z.infer<typeof selectWatchListToTickerSchema>;

const makeWatchListToTickerSchema = insertWatchListToTickerSchema
  .pick({ tickerId: true, watchListId: true })
  .strict();

export function makeWatchListToTicker(data: Z.infer<typeof makeWatchListToTickerSchema>) {
  return makeWatchListToTickerSchema.parse(data);
}
