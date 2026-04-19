import { type Tracer, injectTraceContext } from '@modules/tracing';
import type { DrizzleConfig } from 'drizzle-orm';
import { type BunSQLDatabase, drizzle } from 'drizzle-orm/bun-sql';
import type { Except } from 'type-fest';
import schema from './schema';

export type Schema = typeof schema;

export type DBClient = BunSQLDatabase<Schema>;

export interface MakeDBClientOpts
  extends Except<DrizzleConfig<typeof schema>, 'casing' | 'schema' | 'logger'> {
  url: string;
  tracer: Tracer;
}

export function makeDBClient(opts: MakeDBClientOpts): DBClient {
  return drizzle({
    connection: opts.url,
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
