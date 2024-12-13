import dotenv from 'dotenv';
import Z from 'zod';

// Load environment variables from .env
dotenv.config();

// Define schema for required and optional configuration
const ConfigSchema = Z.object({
  DATABASE_URL: Z.string().url(),
  BROKER_URL: Z.string().url(),
  TRACE_EXPORTER_URL: Z.string().url(),
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
