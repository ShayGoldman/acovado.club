import { createHash } from 'node:crypto';
import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'bun:test';
import { makeArticleFetcher, type ArticleFetcherDb } from './article-fetcher';

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

    // Must use a two-CTE structure: active_source_count + pending (no DISTINCT window).
    expect(candidateQuery).toContain('WITH active_source_count AS');
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

    // Two-CTE structure: source-count CTE + pending CTE (no DISTINCT window function).
    expect(candidateSql).toMatch(/WITH\s+active_source_count\s+AS/i);
    expect(candidateSql).toMatch(/pending\s+AS\s*\(/i);

    // Source count is a plain COUNT(DISTINCT) scalar — NOT a window expression.
    expect(candidateSql).toMatch(
      /COUNT\s*\(\s*DISTINCT\s+su2\.discovered_by_source_id\s*\)/i,
    );
    expect(candidateSql).not.toMatch(/COUNT.*DISTINCT.*OVER\s*\(\s*\)/i);

    // Per-source window function inside pending CTE.
    expect(candidateSql).toMatch(/ROW_NUMBER\s*\(\s*\)\s+OVER\s*\(/i);
    expect(candidateSql).toMatch(/PARTITION\s+BY\s+su\.discovered_by_source_id/i);

    // Source count joined via CROSS JOIN; fairness filter uses NULLIF for zero-safety.
    expect(candidateSql).toMatch(/CROSS\s+JOIN\s+active_source_count/i);
    expect(candidateSql).toMatch(
      /rn\s*<=\s*CEIL\s*\(100\.0\s*\/\s*NULLIF\s*\(sc\.cnt,\s*0\)\)/i,
    );

    // Deterministic ordering: rank-1 first across all sources, then alphabetical by source.
    expect(candidateSql).toMatch(/ORDER\s+BY\s+rn\s+ASC,\s+external_id\s+ASC/i);

    // Outer limit preserved.
    expect(candidateSql).toMatch(/LIMIT\s+100/i);

    // Anti-join is still present.
    expect(candidateSql).toMatch(
      /LEFT\s+JOIN\s+acovado\.news_articles\s+na\s+ON\s+na\.url\s*=\s*su\.url/i,
    );
    expect(candidateSql).toMatch(/WHERE\s+na\.id\s+IS\s+NULL/i);
  });
});

// ---------------------------------------------------------------------------
// Live-Postgres smoke — §12b fetchCandidates (skipped when DATABASE_URL unset)
// ---------------------------------------------------------------------------
// Run with: DATABASE_URL=postgres://... bun test apps/news-worker/src/article-fetcher.test.ts
//
// Verifies that the fixed CTE executes without the
// "DISTINCT is not implemented for window functions" SQLSTATE 0A000 error,
// and that the per-source fairness cap returns rows from all seeded sources.
// ---------------------------------------------------------------------------

const LIVE_PG_URL = process.env['DATABASE_URL'];

(LIVE_PG_URL ? describe : describe.skip)(
  'live-Postgres smoke — §12b fetchCandidates (requires DATABASE_URL)',
  () => {
    it('executes the two-CTE query without window-DISTINCT error and returns fair candidates', async () => {
      const { drizzle } = await import('drizzle-orm/bun-sql');
      const liveClient = drizzle({ connection: LIVE_PG_URL! });

      const liveDb: ArticleFetcherDb = {
        execute: (q) => liveClient.execute(q) as Promise<Array<Record<string, unknown>>>,
      };

      const TAG = `smoke-§12b-${Date.now()}`;
      let srcAId = '';
      let srcBId = '';

      try {
        // Ensure schema + tables exist (idempotent — mirrors migration DDL).
        await liveClient.execute(sql`CREATE SCHEMA IF NOT EXISTS acovado`);
        await liveClient.execute(sql`
            CREATE TABLE IF NOT EXISTS acovado.sources (
              id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
              kind           TEXT    NOT NULL,
              external_id    TEXT    NOT NULL,
              display_name   TEXT    NOT NULL,
              config         JSONB,
              active         BOOLEAN NOT NULL DEFAULT TRUE,
              created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              UNIQUE (kind, external_id)
            )
          `);
        await liveClient.execute(sql`
            CREATE TABLE IF NOT EXISTS acovado.seen_urls (
              url_hash                VARCHAR(64) PRIMARY KEY,
              url                     TEXT        NOT NULL,
              discovered_by_source_id UUID        NOT NULL REFERENCES acovado.sources(id),
              first_seen_at           TIMESTAMP   NOT NULL DEFAULT NOW()
            )
          `);
        await liveClient.execute(sql`
            CREATE TABLE IF NOT EXISTS acovado.news_articles (
              id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
              source_id     UUID        NOT NULL REFERENCES acovado.sources(id),
              url           TEXT        NOT NULL,
              title         TEXT,
              extracted_body TEXT,
              html_hash     VARCHAR(64),
              fetch_status  VARCHAR(32) NOT NULL,
              error_message TEXT,
              fetched_at    TIMESTAMPTZ,
              created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              UNIQUE (url)
            )
          `);

        // Seed 2 active news sources with unique TAG-scoped external_ids.
        const rowsA = await liveClient.execute(sql`
            INSERT INTO acovado.sources (kind, external_id, display_name, active)
            VALUES ('news', ${`${TAG}-src-a`}, 'Smoke Test Source A', true)
            RETURNING id
          `);
        srcAId = (rowsA[0] as { id: string }).id;

        const rowsB = await liveClient.execute(sql`
            INSERT INTO acovado.sources (kind, external_id, display_name, active)
            VALUES ('news', ${`${TAG}-src-b`}, 'Smoke Test Source B', true)
            RETURNING id
          `);
        srcBId = (rowsB[0] as { id: string }).id;

        // Seed 5 pending URLs for source A and 3 for source B (none in news_articles).
        for (let i = 0; i < 5; i++) {
          const url = `https://smoke-a.invalid/${TAG}/article-${i}`;
          await liveClient.execute(sql`
              INSERT INTO acovado.seen_urls (url_hash, url, discovered_by_source_id)
              VALUES (${createHash('sha256').update(url).digest('hex')}, ${url}, ${srcAId})
            `);
        }
        for (let i = 0; i < 3; i++) {
          const url = `https://smoke-b.invalid/${TAG}/article-${i}`;
          await liveClient.execute(sql`
              INSERT INTO acovado.seen_urls (url_hash, url, discovered_by_source_id)
              VALUES (${createHash('sha256').update(url).digest('hex')}, ${url}, ${srcBId})
            `);
        }

        const fetcher = makeArticleFetcher({
          db: liveDb,
          browser: {} as any,
          logger: makeNullLogger(),
          tracer: makeNullTracer(),
        });

        // Core assertion: must not throw SQLSTATE 0A000.
        const candidates = await fetcher.fetchCandidates();

        // All 8 seeded URLs (5+3) are below the per-source cap of ceil(100/2)=50.
        expect(candidates.length).toBe(8);

        // Both sources represented in results.
        const returnedSources = new Set(candidates.map((c) => c.sourceId));
        expect(returnedSources.has(srcAId)).toBe(true);
        expect(returnedSources.has(srcBId)).toBe(true);

        // No single source exceeds its fair share.
        const countA = candidates.filter((c) => c.sourceId === srcAId).length;
        const countB = candidates.filter((c) => c.sourceId === srcBId).length;
        const cap = Math.ceil(100 / returnedSources.size);
        expect(countA).toBeLessThanOrEqual(cap);
        expect(countB).toBeLessThanOrEqual(cap);
      } finally {
        // FK order: seen_urls before sources; news_articles has no test rows.
        if (srcAId) {
          await liveClient.execute(
            sql`DELETE FROM acovado.seen_urls WHERE discovered_by_source_id = ${srcAId}`,
          );
          await liveClient.execute(sql`DELETE FROM acovado.sources WHERE id = ${srcAId}`);
        }
        if (srcBId) {
          await liveClient.execute(
            sql`DELETE FROM acovado.seen_urls WHERE discovered_by_source_id = ${srcBId}`,
          );
          await liveClient.execute(sql`DELETE FROM acovado.sources WHERE id = ${srcBId}`);
        }
      }
    }, 60_000);
  },
);
