import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import S from '../schema';
import Z from 'zod';

const insertInferenceLogSchema = createInsertSchema(S.inferenceLogs, {
  config: Z.record(Z.string(), Z.any()),
  prompt: Z.any(),
  response: Z.any().nullable(),
  metadata: Z.record(Z.string(), Z.any()).nullable(),
  status: Z.enum(['success', 'error']),
});

const selectInferenceLogSchema = createSelectSchema(S.inferenceLogs, {
  config: Z.record(Z.string(), Z.any()),
  prompt: Z.any(),
  response: Z.any().nullable(),
  metadata: Z.record(Z.string(), Z.any()).nullable(),
  status: Z.enum(['success', 'error']),
});

export type InferenceLog = Z.infer<typeof selectInferenceLogSchema>;

const makeInferenceLogInsertSchema = insertInferenceLogSchema
  .pick({
    name: true,
    model: true,
    config: true,
    prompt: true,
    response: true,
    durationMs: true,
    status: true,
    error: true,
    retryCount: true,
    metadata: true,
  })
  .strict();

const makeInferenceLogUpdateSchema = makeInferenceLogInsertSchema.partial().strict();

export function makeInferenceLog(data: unknown): InferenceLog {
  return selectInferenceLogSchema.parse(data);
}

export function makeInferenceLogInsertValue(
  data: Z.infer<typeof makeInferenceLogInsertSchema>,
) {
  return makeInferenceLogInsertSchema.parse(data);
}

export function makeInferenceLogUpdateValue(
  data: Z.infer<typeof makeInferenceLogUpdateSchema>,
) {
  return makeInferenceLogUpdateSchema.parse(data);
}
