import Z from 'zod';

export type Environment = Z.infer<typeof environmentSchema>;

export const environmentSchema = Z.object({
  NODE_ENV: Z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: Z.string().url(),
  RABBITMQ_URL: Z.string().url(),
  TRACE_EXPORTER_URLS: Z.string()
    .transform((v) => v.split(',').map((s) => s.trim()))
    .pipe(Z.array(Z.string().url())),
  YOUTUBE_API_KEY: Z.string().min(1),
  YOUTUBE_FETCH_LIMIT: Z.coerce.number().positive().default(10),
  POLL_CRON: Z.string().default('0 * * * *'),
});

export function parseEnv(env: NodeJS.ProcessEnv): Environment {
  return environmentSchema.parse(env);
}
