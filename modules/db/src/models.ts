import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import S from './schema';
import Z from 'zod';

const insertTickerSchema = createInsertSchema(S.tickers);

const selectTickerSchema = createSelectSchema(S.tickers);

export type Ticker = Z.infer<typeof selectTickerSchema>;

const makeTickerSchema = insertTickerSchema
  .pick({
    name: true,
    symbol: true,
  })
  .strict();

const makeTickerUpdateSchema = makeTickerSchema.partial().strict();

export function makeTicker(data: Z.infer<typeof makeTickerSchema>) {
  return makeTickerSchema.parse(data);
}

export function makeTickerUpdate(data: Z.infer<typeof makeTickerUpdateSchema>) {
  return makeTickerUpdateSchema.parse(data);
}
