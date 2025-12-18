import Z from 'zod';

export type Environment = Z.infer<typeof environmentSchema>;

const environmentSchema = Z.object({
  NODE_ENV: Z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: Z.string().url(),
  BROKER_URL: Z.string().url(),
  // Format: redis[s]://[[username][:password]@][host][:port][/db-number]
  GRAPH_DB_URL: Z.string().url(),
  OLLAMA_BASE_URL: Z.string().url().default('http://inference-model:11434'),
  TRACE_EXPORTER_URLS: Z.string()
    .transform((val) => val.split(',').map((url) => url.trim()))
    .pipe(Z.array(Z.string().url())),
});

export default environmentSchema.parse(process.env);
