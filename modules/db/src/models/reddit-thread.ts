import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import S from '@/schema';
import Z from 'zod';

const insertRedditThreadSchema = createInsertSchema(S.redditThreads, {
  data: Z.record(Z.string(), Z.any()),
});

const selectRedditThreadSchema = createSelectSchema(S.redditThreads, {
  data: Z.record(Z.string(), Z.any()),
});

export type RedditThread = Z.infer<typeof selectRedditThreadSchema>;

const makeRedditThreadSchema = insertRedditThreadSchema
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

const makeRedditThreadUpdateSchema = makeRedditThreadSchema.partial().strict();

export function makeRedditThread(data: Z.infer<typeof makeRedditThreadSchema>) {
  return makeRedditThreadSchema.parse(data);
}

export function makeRedditThreadUpdate(
  data: Z.infer<typeof makeRedditThreadUpdateSchema>,
) {
  return makeRedditThreadUpdateSchema.parse(data);
}
