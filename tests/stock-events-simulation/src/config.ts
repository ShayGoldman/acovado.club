import Z from 'zod';

// Note: Bun automatically loads .env files, no need for dotenv

// Define schema for required and optional configuration
const ConfigSchema = Z.object({
  DATABASE_URL: Z.string().url(),
  BROKER_URL: Z.string().url(),
  TRACE_EXPORTER_URLS: Z.string()
    .transform((val) => val.split(',').map((url) => url.trim()))
    .pipe(Z.array(Z.string().url())),
  QUEUE_NAME: Z.string().default('signal.created'),
});

export type Config = Z.infer<typeof ConfigSchema>;

// Parse and validate configuration
export function loadConfig() {
  const parsedConfig = ConfigSchema.safeParse(process.env);

  if (!parsedConfig.success) {
    console.error('Invalid configuration:', parsedConfig.error.format());
    throw new Error('Configuration validation failed.');
  }

  return parsedConfig.data;
}
