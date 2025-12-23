import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import S from '../schema';
import Z from 'zod';

const insertRedditThreadSchema = createInsertSchema(S.redditThreads, {
  data: Z.record(Z.string(), Z.any()),
});

const selectRedditThreadSchema = createSelectSchema(S.redditThreads, {
  data: Z.record(Z.string(), Z.any()),
});

export type RedditThread = Z.infer<typeof selectRedditThreadSchema>;

const makeRedditThreadInsertSchema = insertRedditThreadSchema
  .pick({
    redditId: true,
    subreddit: true,
    title: true,
    author: true,
    selftext: true,
    url: true,
    permalink: true,
    score: true,
    numComments: true,
    createdUtc: true,
    status: true,
    data: true,
  })
  .strict();

const makeRedditThreadUpdateSchema = makeRedditThreadInsertSchema.partial().strict();

export function makeRedditThread(data: unknown): RedditThread {
  return selectRedditThreadSchema.parse(data);
}

export function makeRedditThreadInsertValue(
  data: Z.infer<typeof makeRedditThreadInsertSchema>,
) {
  return makeRedditThreadInsertSchema.parse(data);
}

export function makeRedditThreadUpdateValue(
  data: Z.infer<typeof makeRedditThreadUpdateSchema>,
) {
  return makeRedditThreadUpdateSchema.parse(data);
}
