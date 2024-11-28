import Z from 'zod';

export type Environment = Z.infer<typeof environmentSchema>;

const environmentSchema = Z.object({
  NODE_ENV: Z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: Z.string().url(),
  BROKER_URL: Z.string().url(),
  TRACE_EXPORTER_URL: Z.string().url(),
});

export default environmentSchema.parse(process.env);
