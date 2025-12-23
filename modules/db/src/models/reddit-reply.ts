import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import Z from 'zod';
import S from '../schema';

const insertRedditReplySchema = createInsertSchema(S.redditReplies, {
  data: Z.record(Z.string(), Z.any()),
});

const selectRedditReplySchema = createSelectSchema(S.redditReplies, {
  data: Z.record(Z.string(), Z.any()),
});

export type RedditReply = Z.infer<typeof selectRedditReplySchema>;

const makeRedditReplyInsertSchema = insertRedditReplySchema
  .pick({
    redditId: true,
    threadId: true,
    parentRedditId: true,
    author: true,
    body: true,
    score: true,
    createdUtc: true,
    status: true,
    data: true,
  })
  .strict();

const makeRedditReplyUpdateSchema = makeRedditReplyInsertSchema.partial().strict();

export function makeRedditReply(data: unknown): RedditReply {
  return selectRedditReplySchema.parse(data);
}

export function makeRedditReplyInsertValue(
  data: Z.infer<typeof makeRedditReplyInsertSchema>,
) {
  return makeRedditReplyInsertSchema.parse(data);
}

export function makeRedditReplyUpdateValue(
  data: Z.infer<typeof makeRedditReplyUpdateSchema>,
) {
  return makeRedditReplyUpdateSchema.parse(data);
}
