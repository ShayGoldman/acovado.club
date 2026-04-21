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
  NEWS_POLL_CRON: Z.string().default('*/10 * * * *'),
});

export function parseEnv(env: NodeJS.ProcessEnv): Environment {
  return environmentSchema.parse(env);
}
