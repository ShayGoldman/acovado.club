import { defineConfig } from 'drizzle-kit';

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
    url: 'postgresql://development:development@localhost:5432/development',
  },

  breakpoints: true,
  strict: true,
  verbose: true,
});
