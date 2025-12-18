import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import Z from 'zod';
import S from '@/schema';

const insertRedditReplySchema = createInsertSchema(S.redditReplies, {
  data: Z.record(Z.string(), Z.any()),
});

const selectRedditReplySchema = createSelectSchema(S.redditReplies, {
  data: Z.record(Z.string(), Z.any()),
});

export type RedditReply = Z.infer<typeof selectRedditReplySchema>;

const makeRedditReplySchema = insertRedditReplySchema
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

const makeRedditReplyUpdateSchema = makeRedditReplySchema.partial().strict();

export function makeRedditReply(data: Z.infer<typeof makeRedditReplySchema>) {
  return makeRedditReplySchema.parse(data);
}

export function makeRedditReplyUpdate(data: Z.infer<typeof makeRedditReplyUpdateSchema>) {
  return makeRedditReplyUpdateSchema.parse(data);
}
