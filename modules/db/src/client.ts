import schema from '@/schema';
import { injectTraceContext, type Tracer } from '@modules/tracing';
import type { DrizzleConfig } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { Except } from 'type-fest';

export type Schema = typeof schema;

export type DBClient = NodePgDatabase<Schema>;

export interface MakeDBClientOpts
  extends Except<DrizzleConfig<typeof schema>, 'casing' | 'schema' | 'logger'> {
  url: string;
  tracer: Tracer;
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
        const tracedHeaders = injectTraceContext({});
        opts.tracer.with('DB query', { headers: tracedHeaders }, async (c) => {
          const humanizedParams = params
            .map((p, idx) =>
              [`${idx + 1}$`, typeof p === 'string' ? `'${p}'` : p].join(': '),
            )
            .join(', ');

          c.log.debug({ query, params: humanizedParams }, 'SQL Query executed');
        });
      },
    },
  });
}
