import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import schema from '@/schema';
import type { DrizzleConfig } from 'drizzle-orm';
import type { Except } from 'type-fest';

export type Schema = typeof schema;

export interface MakeDBClientOpts
  extends Except<DrizzleConfig<typeof schema>, 'casing' | 'schema'> {
  url: string;
}

export function makeDBClient(opts: MakeDBClientOpts): NodePgDatabase<Schema> {
  // TODO validate dis
  const pool = new Pool({
    connectionString: opts.url,
  });

  return drizzle<Schema>({
    client: pool,
    casing: 'snake_case',
    schema,
  });
}
