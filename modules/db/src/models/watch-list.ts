import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import S from '@/schema';
import Z from 'zod';

const insertWatchListSchema = createInsertSchema(S.watchLists);

const selectWatchListSchema = createSelectSchema(S.watchLists);

export type WatchList = Z.infer<typeof selectWatchListSchema>;

const makeWatchListSchema = insertWatchListSchema
  .pick({
    name: true,
  })
  .strict();

const makeWatchListUpdateSchema = makeWatchListSchema.partial().strict();

export function makeWatchList(data: Z.infer<typeof makeWatchListSchema>) {
  return makeWatchListSchema.parse(data);
}

export function makeWatchListUpdate(data: Z.infer<typeof makeWatchListUpdateSchema>) {
  return makeWatchListUpdateSchema.parse(data);
}
