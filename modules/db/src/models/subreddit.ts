import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import S from '../schema';
import type Z from 'zod';

const insertTrackedSubredditSchema = createInsertSchema(S.trackedSubreddits);

const selectTrackedSubredditSchema = createSelectSchema(S.trackedSubreddits);

export type TrackedSubreddit = Z.infer<typeof selectTrackedSubredditSchema>;
export type TrackedSubredditStatus = TrackedSubreddit['status'];

const makeTrackedSubredditInsertSchema = insertTrackedSubredditSchema
  .pick({
    name: true,
    status: true,
  })
  .strict();

const makeTrackedSubredditUpdateSchema = makeTrackedSubredditInsertSchema
  .partial()
  .strict();

export function makeTrackedSubreddit(data: unknown): TrackedSubreddit {
  return selectTrackedSubredditSchema.parse(data);
}

export function makeTrackedSubredditInsertValue(
  data: Z.infer<typeof makeTrackedSubredditInsertSchema>,
) {
  return makeTrackedSubredditInsertSchema.parse(data);
}

export function makeTrackedSubredditUpdateValue(
  data: Z.infer<typeof makeTrackedSubredditUpdateSchema>,
) {
  return makeTrackedSubredditUpdateSchema.parse(data);
}
