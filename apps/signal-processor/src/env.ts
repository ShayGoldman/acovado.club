import Z from 'zod';

export const environmentSchema = Z.object({
  NODE_ENV: Z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: Z.string().url(),
  RABBITMQ_URL: Z.string().url(),
  TRACE_EXPORTER_URLS: Z.string()
    .transform((v) => v.split(',').map((s) => s.trim()))
    .pipe(Z.array(Z.string().url())),
  ANTHROPIC_API_KEY: Z.string(),
  PORT: Z.coerce.number().positive().default(3001),
});

export type Environment = Z.infer<typeof environmentSchema>;

export function parseEnv(env: NodeJS.ProcessEnv): Environment {
  return environmentSchema.parse(env);
}
