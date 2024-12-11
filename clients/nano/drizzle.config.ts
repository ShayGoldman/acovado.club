import { defineConfig } from 'drizzle-kit';
import Env from './env';

export default defineConfig({
  dialect: 'postgresql',
  introspect: {
    casing: 'camel',
  },
  breakpoints: true,
  strict: true,
  verbose: true,

  dbCredentials: {
    url: Env.DATABASE_URL,
  },
});
