import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import S from '@/schema';
import Z from 'zod';

const insertStorySchema = createInsertSchema(S.stories);

const selectStorySchema = createSelectSchema(S.stories);

export type Story = Z.infer<typeof selectStorySchema>;

const makeStorySchema = insertStorySchema
  .pick({
    ticker: true,
    volumeChange: true,
  })
  .strict();

export function makeStory(data: Z.infer<typeof makeStorySchema>) {
  return makeStorySchema.parse(data);
}
