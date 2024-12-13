import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import S from '@/schema';
import Z from 'zod';

const insertSignalMetricSchema = createInsertSchema(S.signalMetrics);

const selectSignalMetricSchema = createSelectSchema(S.signalMetrics);

export type SignalMetric = Z.infer<typeof selectSignalMetricSchema>;

const makeSignalMetricSchema = insertSignalMetricSchema
  .pick({
    collectionId: true,
    tickerId: true,
    type: true,
    metric: true,
  })
  .strict();

const makeSignalMetricUpdateSchema = makeSignalMetricSchema.partial().strict();

export function makeSignalMetric(data: Z.infer<typeof makeSignalMetricSchema>) {
  return makeSignalMetricSchema.parse(data);
}

export function makeSignalMetricUpdate(
  data: Z.infer<typeof makeSignalMetricUpdateSchema>,
) {
  return makeSignalMetricUpdateSchema.parse(data);
}
