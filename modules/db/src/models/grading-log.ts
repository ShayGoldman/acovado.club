import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import S from '../schema';
import Z from 'zod';

const insertGradingLogSchema = createInsertSchema(S.gradingLogs, {
  graderConfig: Z.record(Z.string(), Z.any()),
  graderPrompt: Z.any(),
});

const selectGradingLogSchema = createSelectSchema(S.gradingLogs, {
  graderConfig: Z.record(Z.string(), Z.any()),
  graderPrompt: Z.any(),
});

export type GradingLog = Z.infer<typeof selectGradingLogSchema>;

const makeGradingLogInsertSchema = insertGradingLogSchema
  .pick({
    inferenceLogId: true,
    graderModel: true,
    graderConfig: true,
    graderPrompt: true,
    confidence: true,
    passed: true,
    feedback: true,
    reasoning: true,
    durationMs: true,
    status: true,
    error: true,
  })
  .strict();

const makeGradingLogUpdateSchema = makeGradingLogInsertSchema.partial().strict();

export function makeGradingLog(data: unknown): GradingLog {
  return selectGradingLogSchema.parse(data);
}

export function makeGradingLogInsertValue(
  data: Z.infer<typeof makeGradingLogInsertSchema>,
) {
  return makeGradingLogInsertSchema.parse(data);
}

export function makeGradingLogUpdateValue(
  data: Z.infer<typeof makeGradingLogUpdateSchema>,
) {
  return makeGradingLogUpdateSchema.parse(data);
}
