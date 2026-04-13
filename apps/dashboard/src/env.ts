import Z from 'zod';

export type Environment = Z.infer<typeof environmentSchema>;

export const environmentSchema = Z.object({
  NODE_ENV: Z.enum(['development', 'test', 'production']).default('development'),
  PORT: Z.coerce.number().positive().default(3000),
  DATABASE_URL: Z.string().url(),
  TRACE_EXPORTER_URLS: Z.string()
    .transform((val) => val.split(',').map((url) => url.trim()))
    .pipe(Z.array(Z.string().url())),
});

export function parseEnv(env: NodeJS.ProcessEnv): Environment {
  return environmentSchema.parse(env);
}
