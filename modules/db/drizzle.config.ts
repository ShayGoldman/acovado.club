import { defineConfig } from 'drizzle-kit';
import Env from './src/env';

export default defineConfig({
  out: './src/migrations',
  dialect: 'postgresql',
  schema: './src/schema.ts',

  introspect: {
    casing: 'camel',
  },

  migrations: {
    prefix: 'timestamp',
    table: '__migrations__',
    schema: 'migrations',
  },

  dbCredentials: {
    url: Env.DATABASE_URL,
  },

  breakpoints: true,
  strict: true,
  verbose: true,
});
