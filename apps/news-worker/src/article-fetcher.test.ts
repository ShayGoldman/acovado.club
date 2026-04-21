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

// ---------------------------------------------------------------------------
// Error-path INSERT — Principal requirement: must insert fetch_status='error'
// so the anti-join candidate query drops the URL on subsequent runs.
// ---------------------------------------------------------------------------

describe('makeArticleFetcher — error path', () => {
  it('inserts fetch_status=error row after all retries exhausted', async () => {
    const executedQueries: string[] = [];

    const db = {
      async execute(query: string) {
        executedQueries.push(query);
        return [];
      },
    };

    const browser = {
      newPage: async () => {
        throw new Error('navigation failed');
      },
    } as any;

    makeArticleFetcher({
      db,
      browser,
      logger: makeNullLogger(),
      tracer: makeNullTracer(),
      maxRetries: 1,
      concurrency: 1,
      navTimeoutMs: 1_000,
    });

    // Directly call the internal fetch path via runOnce with a seeded candidate query.
    // We override the DB execute to return one candidate row for the first call,
    // then empty (simulating the INSERT queries that follow).
    let callCount = 0;
    const dbWithCandidate = {
      async execute(query: string) {
        executedQueries.push(query);
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

    const fetcherWithCandidate = makeArticleFetcher({
      db: dbWithCandidate,
      browser,
      logger: makeNullLogger(),
      tracer: makeNullTracer(),
      maxRetries: 1,
      concurrency: 1,
      navTimeoutMs: 100,
    });

    await fetcherWithCandidate.runOnce();

    // The last INSERT query should contain fetch_status='error'.
    const insertQueries = executedQueries.filter((q) =>
      q.includes('INSERT INTO acovado.news_articles'),
    );
    expect(insertQueries.length).toBeGreaterThan(0);

    const errorInsert = insertQueries.find((q) => q.includes("'error'"));
    expect(errorInsert).toBeDefined();
    expect(errorInsert).toContain('fetch_status');
    expect(errorInsert).toContain('ON CONFLICT (url) DO NOTHING');
  });

  it('skips fetch when robots.txt disallows the URL', async () => {
    const executedQueries: string[] = [];
    let callCount = 0;

    const db = {
      async execute(query: string) {
        executedQueries.push(query);
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
    const insertQueries = executedQueries.filter((q) =>
      q.includes('INSERT INTO acovado.news_articles'),
    );
    expect(insertQueries.length).toBe(0);
  });
});
