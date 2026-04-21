import { describe, expect, it } from 'bun:test';
import type { Browser, Page } from 'playwright';
import { makeDiscovery } from './discovery';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

function makeNullTracer() {
  return {
    with: async (_name: string, _opts: unknown, fn?: (...args: unknown[]) => unknown) => {
      const cb = typeof _opts === 'function' ? (_opts as typeof fn)! : fn!;
      return cb({
        annotate: () => undefined,
        log: makeNullLogger(),
        with: () => undefined,
      });
    },
    shutdown: async () => undefined,
  } as any;
}

function makeNullLogger() {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  } as any;
}

/**
 * Minimal in-memory DB double.
 * Supports the three queries discovery.ts issues:
 *   - SELECT sources (kind = 'news')
 *   - SELECT news_source_configs
 *   - SELECT url_hash FROM seen_urls WHERE url_hash IN (...)
 *   - INSERT INTO seen_urls ... ON CONFLICT DO NOTHING
 */
function makeTestDb(
  sources: Array<{ id: string; external_id: string; poll_interval_ms: number | null }>,
  seedConfigs: Array<{ id: string; source_id: string; seed_url: string }>,
) {
  const seenUrls = new Map<string, { url: string; discovered_by_source_id: string }>();
  const insertLog: Array<{ url_hash: string; url: string; source_id: string }> = [];

  async function execute(query: string): Promise<Array<Record<string, unknown>>> {
    const q = query.trim().toLowerCase();

    if (q.includes('from acovado.sources')) {
      return sources as any;
    }

    if (q.includes('from acovado.news_source_configs')) {
      const match = query.match(/source_id = '([^']+)'/);
      const sourceId = match?.[1];
      return seedConfigs.filter((c) => c.source_id === sourceId) as any;
    }

    if (q.includes('from acovado.seen_urls where url_hash in')) {
      const hashMatch = query.match(/IN\s*\(([^)]+)\)/i);
      if (!hashMatch) return [];
      const hashes = hashMatch[1]!.split(',').map((h) => h.trim().replace(/'/g, ''));
      return hashes.filter((h) => seenUrls.has(h)).map((h) => ({ url_hash: h }));
    }

    if (q.includes('insert into acovado.seen_urls')) {
      // Parse multi-row VALUES clause: ('hash', 'url', 'source_id'), ...
      const valuesSection =
        query.match(/values\s+([\s\S]+?)(?:on conflict|$)/i)?.[1] ?? '';
      const rowPattern = /\('([^']+)',\s*'((?:[^']|'')*)',\s*'([^']+)'\)/g;
      let m = rowPattern.exec(valuesSection);
      while (m !== null) {
        const hash = m[1]!;
        const url = m[2]!;
        const sourceId = m[3]!;
        const unescapedUrl = url.replace(/''/g, "'");
        if (!seenUrls.has(hash)) {
          seenUrls.set(hash, { url: unescapedUrl, discovered_by_source_id: sourceId });
          insertLog.push({ url_hash: hash, url: unescapedUrl, source_id: sourceId });
        }
        m = rowPattern.exec(valuesSection);
      }
      return [];
    }

    return [];
  }

  return { execute, seenUrls, insertLog };
}

function makeTestBrowser(hrefsByPage: Map<string, string[]>) {
  return {
    newPage: async () => {
      let currentUrl = '';
      const page: Partial<Page> = {
        goto: async (url: string) => {
          currentUrl = url;
          return null as any;
        },
        $$eval: async (
          _selector: string,
          fn: (els: Array<{ href: string }>) => string[],
        ) => {
          const hrefs = hrefsByPage.get(currentUrl) ?? [];
          const anchors = hrefs.map((href) => ({ href }));
          return fn(anchors);
        },
        close: async () => undefined,
      };
      return page as Page;
    },
  } as unknown as Browser;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('makeDiscovery — dedup correctness', () => {
  const SOURCE_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
  const SEED_URL = 'https://finance.yahoo.com/news/';

  const defaultSources = [
    { id: SOURCE_ID, external_id: 'yahoo-finance', poll_interval_ms: null },
  ];
  const defaultSeeds = [{ id: 'seed-1', source_id: SOURCE_ID, seed_url: SEED_URL }];

  it('inserts only one row for a duplicate href on the same seed page', async () => {
    const db = makeTestDb(defaultSources, defaultSeeds);
    const browser = makeTestBrowser(
      new Map([
        [
          SEED_URL,
          [
            `${SEED_URL}article-abc`,
            `${SEED_URL}article-abc`, // duplicate
          ],
        ],
      ]),
    );

    const discovery = makeDiscovery({
      db: db as any,
      browser,
      logger: makeNullLogger(),
      tracer: makeNullTracer(),
    });

    await discovery.runOnce();

    // Only one row in seenUrls despite two identical hrefs
    expect(db.insertLog.length).toBe(1);
    expect(db.seenUrls.size).toBe(1);
  });

  it('reports 0 new URLs for a URL seen on a second poll cycle', async () => {
    const db = makeTestDb(defaultSources, defaultSeeds);
    const hrefs = [`${SEED_URL}article-xyz`];
    const browser = makeTestBrowser(new Map([[SEED_URL, hrefs]]));

    const discovery = makeDiscovery({
      db: db as any,
      browser,
      logger: makeNullLogger(),
      tracer: makeNullTracer(),
    });

    // First tick — discovers the URL
    await discovery.runOnce();
    const insertedAfterFirst = db.insertLog.length;
    expect(insertedAfterFirst).toBe(1);

    // Second tick — cadence knob: force the last-polled clock back so the source isn't skipped
    discovery as any; // no direct access to lastPolledAt — use null pollIntervalMs + 0 last
    // Rebuild with fresh discovery instance sharing the same DB (seenUrls persisted)
    const discovery2 = makeDiscovery({
      db: db as any,
      browser,
      logger: makeNullLogger(),
      tracer: makeNullTracer(),
    });
    await discovery2.runOnce();

    // No new inserts on second poll
    expect(db.insertLog.length).toBe(insertedAfterFirst);
  });

  it('normalizes tracker-param variants to the same hash', async () => {
    const db = makeTestDb(defaultSources, defaultSeeds);
    const browser = makeTestBrowser(
      new Map([
        [
          SEED_URL,
          [
            `${SEED_URL}article?utm_source=twitter`,
            `${SEED_URL}article`, // clean version
          ],
        ],
      ]),
    );

    const discovery = makeDiscovery({
      db: db as any,
      browser,
      logger: makeNullLogger(),
      tracer: makeNullTracer(),
    });

    await discovery.runOnce();

    // Both URLs normalize to the same URL and hash → only 1 insert
    expect(db.insertLog.length).toBe(1);
  });

  it('excludes cross-domain links from candidate set', async () => {
    const db = makeTestDb(defaultSources, defaultSeeds);
    const browser = makeTestBrowser(
      new Map([
        [
          SEED_URL,
          [
            `${SEED_URL}article-local`,
            'https://www.cnbc.com/external-article', // cross-domain
            'https://twitter.com/share?url=x', // cross-domain
          ],
        ],
      ]),
    );

    const discovery = makeDiscovery({
      db: db as any,
      browser,
      logger: makeNullLogger(),
      tracer: makeNullTracer(),
    });

    await discovery.runOnce();

    // Only the local Yahoo Finance article should be inserted
    expect(db.insertLog.length).toBe(1);
    expect(db.insertLog[0]!.url).toContain('finance.yahoo.com');
  });
});
