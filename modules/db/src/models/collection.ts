import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import S from '@/schema';
import Z from 'zod';

const statusEnumSchema = Z.enum(['pending', 'in_progress', 'completed', 'failed']);
const typeEnumSchema = Z.enum(['ticker', 'html']);

// Zod schemas for each collection type
const tickerCollectionSchema = Z.object({
  type: Z.literal('ticker'),
  tickerId: Z.string(),
});

const htmlCollectionSchema = Z.object({
  type: Z.literal('html'),
  url: Z.string().url(),
});

const insertCollectionSchema = createInsertSchema(S.collections, {
  status: statusEnumSchema,
  type: typeEnumSchema,
  data: Z.discriminatedUnion('type', [tickerCollectionSchema, htmlCollectionSchema]),
});

const selectCollectionSchema = createSelectSchema(S.collections, {
  status: statusEnumSchema,
  type: typeEnumSchema,
  data: Z.discriminatedUnion('type', [tickerCollectionSchema, htmlCollectionSchema]),
});

export type Collection = Z.infer<typeof selectCollectionSchema>;
const makeCollectionSchema = insertCollectionSchema
  .pick({
    status: true,
    type: true,
    data: true,
  })
  .strict();

const makeCollectionUpdateSchema = makeCollectionSchema.partial().strict();

export function makeCollection(data: Z.infer<typeof makeCollectionSchema>) {
  return makeCollectionSchema.parse(data);
}

export function makeCollectionUpdate(data: Z.infer<typeof makeCollectionUpdateSchema>) {
  return makeCollectionUpdateSchema.parse(data);
}
