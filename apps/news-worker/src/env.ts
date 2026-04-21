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
  NEWS_NAV_TIMEOUT_MS: Z.coerce.number().positive().default(30_000),
  NEWS_FETCH_MAX_RETRIES: Z.coerce.number().min(0).default(2),
  NEWS_FETCH_CONCURRENCY: Z.coerce.number().positive().default(3),
  NEWS_ROBOTS_CACHE_TTL_MS: Z.coerce
    .number()
    .positive()
    .default(24 * 60 * 60 * 1_000),
});

export function parseEnv(env: NodeJS.ProcessEnv): Environment {
  return environmentSchema.parse(env);
}
