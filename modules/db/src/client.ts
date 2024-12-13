import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import schema from '@/schema';
import type { DrizzleConfig } from 'drizzle-orm';
import type { Except } from 'type-fest';
import type { Logger } from '@modules/logger';

export type Schema = typeof schema;

export type DBClient = NodePgDatabase<Schema>;

export interface MakeDBClientOpts
  extends Except<DrizzleConfig<typeof schema>, 'casing' | 'schema' | 'logger'> {
  url: string;
  logger: Logger;
}

export function makeDBClient(opts: MakeDBClientOpts): DBClient {
  // TODO validate dis
  const pool = new Pool({
    connectionString: opts.url,
  });

  return drizzle<Schema>({
    client: pool,
    casing: 'snake_case',
    schema,
    logger: {
      logQuery(query: string, params: unknown[]) {
        opts.logger.debug({ query, params }, 'SQL Query executed');
      },
    },
  });
}
