import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'bun:test';
import { makeArticleFetcher } from './article-fetcher';

// ---------------------------------------------------------------------------
// Minimal stubs
// ---------------------------------------------------------------------------

function makeNullTracer() {
  return {
    with: async (_name: string, _optsOrFn: unknown, fn?: unknown) => {
      const actualFn = typeof _optsOrFn === 'function' ? _optsOrFn : fn;
      return (actualFn as (ctx: { annotate: () => void }) => Promise<unknown>)({
        annotate: () => undefined,
      });
    },
  } as any;
}

function makeNullLogger() {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  } as any;
}

// Extract the static SQL text portions from a drizzle sql`` object.
// StringChunks are { value: string[] }; params are stored as raw primitives.
function getSqlText(q: SQL<unknown>): string {
  return q.queryChunks
    .filter(
      (c): c is { value: string[] } =>
        typeof c === 'object' && c !== null && Array.isArray((c as any).value),
    )
    .flatMap((c) => c.value)
    .join('');
}

// Extract the bound parameter values from a drizzle sql`` object.
function getSqlParams(q: SQL<unknown>): unknown[] {
  return q.queryChunks.filter(
    (c) => !(typeof c === 'object' && c !== null && Array.isArray((c as any).value)),
  );
}

// ---------------------------------------------------------------------------
// fetchCandidates fair-selection — validates CTE query shape without a live DB.
// ---------------------------------------------------------------------------

describe('makeArticleFetcher — fetchCandidates fair-selection query', () => {
  it('uses a fair per-source CTE with ORDER BY rn and LIMIT 100', async () => {
    // Track every SQL string that hits the DB mock.
    const executedSql: SQL<unknown>[] = [];

    let callCount = 0;
    const db = {
      async execute(query: SQL<unknown>) {
        executedSql.push(query);
        if (callCount++ === 0) {
          // Return candidates from two sources: 200 from A, 10 from B.
          // Real DB would apply the CTE; here we just verify the query shape.
          return [];
        }
        return [];
      },
    };

    const browser = {
      newPage: async () => ({ goto: async () => {}, close: async () => {} }),
    } as any;

    const fetcher = makeArticleFetcher({
      db,
      browser,
      logger: makeNullLogger(),
      tracer: makeNullTracer(),
      maxRetries: 0,
      concurrency: 1,
    });

    await fetcher.runOnce();

    // The first executed SQL must be the candidates query.
    expect(executedSql.length).toBeGreaterThan(0);
    const candidateQuery = getSqlText(executedSql[0]!);

    // Must use a CTE with ROW_NUMBER window function for fair selection.
    expect(candidateQuery).toContain('WITH pending AS');
    expect(candidateQuery).toContain('ROW_NUMBER()');
    expect(candidateQuery).toContain('PARTITION BY');
    // Deterministic ordering: rank then source to prevent non-determinism (gotcha §12b).
    expect(candidateQuery).toContain('ORDER BY rn ASC, external_id ASC');
    expect(candidateQuery).toContain('LIMIT');
    // Must still anti-join against news_articles so fetched URLs are skipped.
    expect(candidateQuery).toContain('acovado.news_articles');
  });
});

// ---------------------------------------------------------------------------
// Error-path INSERT — Principal requirement: must insert fetch_status='error'
// so the anti-join candidate query drops the URL on subsequent runs.
// ---------------------------------------------------------------------------

describe('makeArticleFetcher — error path', () => {
  it('inserts fetch_status=error row after all retries exhausted', async () => {
    const executedSql: SQL<unknown>[] = [];

    const browser = {
      newPage: async () => {
        throw new Error('navigation failed');
      },
    } as any;

    let callCount = 0;
    const db = {
      async execute(query: SQL<unknown>) {
        executedSql.push(query);
        // First call is the candidates query — return one row.
        if (callCount++ === 0) {
          return [
            {
              url: 'https://example.com/article-1',
              source_id: 'src-uuid-1',
              external_id: 'reuters',
            },
          ];
        }
        return [];
      },
    };

    const fetcher = makeArticleFetcher({
      db,
      browser,
      logger: makeNullLogger(),
      tracer: makeNullTracer(),
      maxRetries: 1,
      concurrency: 1,
      navTimeoutMs: 100,
    });

    await fetcher.runOnce();

    // Find INSERT queries targeting news_articles.
    const insertSqls = executedSql.filter((q) =>
      getSqlText(q).includes('INSERT INTO acovado.news_articles'),
    );
    expect(insertSqls.length).toBeGreaterThan(0);

    // The error-path INSERT must use fetch_status='error' as a SQL literal.
    const errorInsert = insertSqls.find((q) => getSqlText(q).includes("'error'"));
    expect(errorInsert).toBeDefined();

    const errorText = getSqlText(errorInsert!);
    expect(errorText).toContain('fetch_status');
    expect(errorText).toContain('ON CONFLICT (url) DO NOTHING');

    // URL and error message must be bound parameters, not interpolated strings.
    const params = getSqlParams(errorInsert!);
    expect(params).toContain('https://example.com/article-1');
    expect(params).toContain('navigation failed');
  });

  it('skips fetch when robots.txt disallows the URL', async () => {
    const executedSql: SQL<unknown>[] = [];
    let callCount = 0;

    const db = {
      async execute(query: SQL<unknown>) {
        executedSql.push(query);
        if (callCount++ === 0) {
          return [
            {
              url: 'https://blocked.example.com/article-1',
              source_id: 'src-uuid-2',
              external_id: 'reuters',
            },
          ];
        }
        return [];
      },
    };

    const browser = {
      newPage: async () => {
        throw new Error('should not be called');
      },
    } as any;

    // Mock fetch so robots.txt returns a disallow-all response.
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = async (url: string) => {
      if (url.includes('robots.txt')) {
        return {
          ok: true,
          text: async () => 'User-agent: *\nDisallow: /',
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    };

    const fetcher = makeArticleFetcher({
      db,
      browser,
      logger: makeNullLogger(),
      tracer: makeNullTracer(),
      maxRetries: 0,
      concurrency: 1,
      navTimeoutMs: 100,
    });

    await fetcher.runOnce();

    // Restore fetch.
    (globalThis as any).fetch = origFetch;

    // No INSERT should have been executed — URL was disallowed by robots.txt.
    const insertSqls = executedSql.filter((q) =>
      getSqlText(q).includes('INSERT INTO acovado.news_articles'),
    );
    expect(insertSqls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// fetchCandidates — §12b fair per-source selection query structure
// ---------------------------------------------------------------------------

describe('makeArticleFetcher — fair-selection candidate query (§12b)', () => {
  it('issues a CTE with ROW_NUMBER PARTITION BY, fairness filter, ORDER BY rn, and LIMIT 100', async () => {
    const executedSql: SQL<unknown>[] = [];

    const db = {
      async execute(query: SQL<unknown>) {
        executedSql.push(query);
        return [];
      },
    };

    const browser = { newPage: async () => ({ close: async () => undefined }) } as any;

    const fetcher = makeArticleFetcher({
      db,
      browser,
      logger: makeNullLogger(),
      tracer: makeNullTracer(),
      concurrency: 1,
    });

    await fetcher.runOnce();

    expect(executedSql.length).toBeGreaterThan(0);

    const candidateSql = getSqlText(executedSql[0]!);

    // CTE structure
    expect(candidateSql).toMatch(/WITH\s+pending\s+AS/i);

    // Per-source window function
    expect(candidateSql).toMatch(/ROW_NUMBER\s*\(\s*\)\s+OVER\s*\(/i);
    expect(candidateSql).toMatch(/PARTITION\s+BY\s+su\.discovered_by_source_id/i);

    // Fairness filter: rn <= CEIL(100 / source_count)
    expect(candidateSql).toMatch(/rn\s*<=\s*CEIL\s*\(100\.0\s*\/\s*source_count\)/i);

    // Deterministic ordering: rank-1 first across all sources, then alphabetical by source
    expect(candidateSql).toMatch(/ORDER\s+BY\s+rn\s+ASC,\s+external_id\s+ASC/i);

    // Outer limit preserved
    expect(candidateSql).toMatch(/LIMIT\s+100/i);

    // Anti-join is still present
    expect(candidateSql).toMatch(
      /LEFT\s+JOIN\s+acovado\.news_articles\s+na\s+ON\s+na\.url\s*=\s*su\.url/i,
    );
    expect(candidateSql).toMatch(/WHERE\s+na\.id\s+IS\s+NULL/i);
  });
});
