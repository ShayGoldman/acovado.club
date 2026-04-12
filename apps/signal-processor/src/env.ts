import Z from 'zod';

export const environmentSchema = Z.object({
  NODE_ENV: Z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: Z.string().url(),
  RABBITMQ_URL: Z.string().url(),
  TRACE_EXPORTER_URLS: Z.string()
    .transform((v) => v.split(',').map((s) => s.trim()))
    .pipe(Z.array(Z.string().url())),
  OLLAMA_BASE_URL: Z.string().url().default('http://localhost:11434'),
  OLLAMA_MODEL: Z.string().default('gemma3:4b'),
  PORT: Z.coerce.number().positive().default(3001),
});

export type Environment = Z.infer<typeof environmentSchema>;

export function parseEnv(env: NodeJS.ProcessEnv): Environment {
  return environmentSchema.parse(env);
}
