import Z from 'zod';

export type Environment = Z.infer<typeof environmentSchema>;

export const environmentSchema = Z.object({
  NODE_ENV: Z.enum(['development', 'test', 'production']).default('development'),
  PORT: Z.coerce.number().positive().default(3000),
  DATABASE_URL: Z.string().url(),
  RABBITMQ_URL: Z.string().url(),
  TRACE_EXPORTER_URLS: Z.string()
    .transform((v) => v.split(',').map((s) => s.trim()))
    .pipe(Z.array(Z.string().url())),
  // Declared in M1 so M2 can land the discovery cron without an env schema change.
  // Intentionally .optional() with a safe default — M1 does not schedule anything.
  NEWS_POLL_CRON: Z.string().default('*/15 * * * *'),
});

export function parseEnv(env: NodeJS.ProcessEnv): Environment {
  return environmentSchema.parse(env);
}
