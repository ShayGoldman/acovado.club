import Z from 'zod';

export type Environment = Z.infer<typeof environmentSchema>;

const environmentSchema = Z.object({
  NODE_ENV: Z.enum(['development', 'test', 'production']).default('development'),
  BROKER_URL: Z.string().url(),
  TRACE_EXPORTER_URLS: Z.string()
    .transform((val) => val.split(',').map((url) => url.trim()))
    .pipe(Z.array(Z.string().url())),
  MAX_RETRIES: Z.coerce.number().optional(),
});

export default environmentSchema.parse(process.env);
