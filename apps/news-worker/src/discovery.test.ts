import { describe, expect, it } from 'bun:test';
import type { Browser, Page } from 'playwright';
import { isArticleUrl, makeDiscovery } from './discovery';

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

function makeTestBrowser(
  hrefsByPage: Map<string, string[]>,
  opts: { trackWaitForSelector?: boolean } = {},
) {
  const waitForSelectorCalls: Array<{ selector: string; url: string }> = [];

  const browser = {
    newPage: async () => {
      let currentUrl = '';
      const page: Partial<Page> = {
        goto: async (url: string) => {
          currentUrl = url;
          return null as any;
        },
        waitForSelector: async (selector: string) => {
          if (opts.trackWaitForSelector) {
            waitForSelectorCalls.push({ selector, url: currentUrl });
          }
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
    _waitForSelectorCalls: waitForSelectorCalls,
  } as unknown as Browser & { _waitForSelectorCalls: typeof waitForSelectorCalls };

  return browser;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// isArticleUrl — §12c URL-shape filter
// ---------------------------------------------------------------------------

describe('isArticleUrl — global deny patterns', () => {
  // Global deny fires before the per-source allowlist check, so these tests
  // apply to all sources regardless of whether they have an allowlist.
  const ALL_SOURCES = [
    'reuters',
    'apnews',
    'marketwatch',
    'benzinga',
    'investing',
    'seeking-alpha',
  ];

  it.each(ALL_SOURCES)('rejects /section/ paths for %s', (src) => {
    expect(isArticleUrl('https://example.com/section/markets', src)).toBe(false);
  });

  it('rejects CNBC /section/ path', () => {
    expect(isArticleUrl('https://www.cnbc.com/section/markets/', 'cnbc')).toBe(false);
  });

  it('rejects /author/ paths', () => {
    expect(isArticleUrl('https://www.cnbc.com/author/jane-doe/', 'cnbc')).toBe(false);
  });

  it('rejects /live-updates/ paths', () => {
    expect(isArticleUrl('https://www.cnbc.com/live-updates/fed-meeting/', 'cnbc')).toBe(
      false,
    );
  });

  it('rejects /live-tv/ paths', () => {
    expect(isArticleUrl('https://www.cnbc.com/live-tv/', 'cnbc')).toBe(false);
  });

  it('rejects /tag/ paths', () => {
    expect(isArticleUrl('https://www.cnbc.com/tag/tech/', 'cnbc')).toBe(false);
  });

  it('rejects /video/ paths for sources without allowlist', () => {
    expect(isArticleUrl('https://www.reuters.com/video/some-clip/', 'reuters')).toBe(
      false,
    );
  });

  it('does NOT reject a path containing "section" as a word in an article slug', () => {
    // /finance/section-by-section/... must not match — pattern is anchored at segment boundary.
    // Uses apnews (pass-through source) since reuters now has an allowlist.
    expect(
      isArticleUrl('https://apnews.com/finance/section-by-section-review/', 'apnews'),
    ).toBe(true);
  });
});

describe('isArticleUrl — CNBC allowlist', () => {
  it('accepts date-slug article URLs', () => {
    expect(
      isArticleUrl('https://www.cnbc.com/2026/04/22/fed-rate-decision.html', 'cnbc'),
    ).toBe(true);
  });

  it('rejects CNBC URLs that do not match date-slug pattern', () => {
    expect(isArticleUrl('https://www.cnbc.com/markets/', 'cnbc')).toBe(false);
  });

  it('rejects CNBC section page after global deny fires', () => {
    expect(isArticleUrl('https://www.cnbc.com/section/investing/', 'cnbc')).toBe(false);
  });
});

describe('isArticleUrl — yahoo-finance allowlist', () => {
  it('accepts /news/<slug> article URLs', () => {
    expect(
      isArticleUrl(
        'https://finance.yahoo.com/news/fed-signals-rate-cut-12345678.html',
        'yahoo-finance',
      ),
    ).toBe(true);
  });

  it('accepts /news/ URLs without a trailing numeric ID (gotcha §12b: looser regex)', () => {
    expect(
      isArticleUrl(
        'https://finance.yahoo.com/news/earnings-watch-q1-2026/',
        'yahoo-finance',
      ),
    ).toBe(true);
  });

  it('rejects /quote/ paths for yahoo-finance (not in /news/ sub-path)', () => {
    expect(isArticleUrl('https://finance.yahoo.com/quote/AAPL/', 'yahoo-finance')).toBe(
      false,
    );
  });
});

describe('isArticleUrl — sources without allowlist pass through', () => {
  it('accepts any non-denied path for reuters', () => {
    expect(
      isArticleUrl(
        'https://www.reuters.com/markets/us/fed-holds-rates-2026-04-22/',
        'reuters',
      ),
    ).toBe(true);
  });

  it('accepts apnews article path', () => {
    expect(
      isArticleUrl('https://apnews.com/article/economy-inflation-abc123', 'apnews'),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('makeDiscovery — dedup correctness', () => {
  const SOURCE_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
  // Use apnews (pass-through source, no URL-shape allowlist) so dedup tests
  // are not affected by the article-URL filter added in §12c.
  // reuters now has an explicit allowlist (§M3.1) so generic slugs would be filtered.
  const SEED_URL = 'https://apnews.com/finance/';

  const defaultSources = [
    { id: SOURCE_ID, external_id: 'apnews', poll_interval_ms: null },
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

    // Only the local apnews article should be inserted
    expect(db.insertLog.length).toBe(1);
    expect(db.insertLog[0]!.url).toContain('apnews.com');
  });
});

// ---------------------------------------------------------------------------
// isArticleUrl — §12c URL-shape filter
// ---------------------------------------------------------------------------

describe('isArticleUrl — global deny patterns (all sources)', () => {
  const sources = ['reuters', 'apnews', 'marketwatch', 'cnbc', 'yahoo-finance'];

  it.each(sources)('rejects /section/ path for %s', (src) => {
    expect(isArticleUrl('https://example.com/section/markets/', src)).toBe(false);
  });

  it.each(sources)('rejects /author/ path for %s', (src) => {
    expect(isArticleUrl('https://example.com/author/john-smith/', src)).toBe(false);
  });

  it.each(sources)('rejects /live-updates/ path for %s', (src) => {
    expect(isArticleUrl('https://example.com/live-updates/fed-meeting/', src)).toBe(
      false,
    );
  });

  it.each(sources)('rejects /live-tv/ path for %s', (src) => {
    expect(isArticleUrl('https://example.com/live-tv/', src)).toBe(false);
  });

  it.each(sources)('rejects /tag/ path for %s', (src) => {
    expect(isArticleUrl('https://example.com/tag/markets/', src)).toBe(false);
  });

  it.each(sources)('rejects /topic/ path for %s', (src) => {
    expect(isArticleUrl('https://example.com/topic/economy/', src)).toBe(false);
  });

  it.each(sources)('rejects /category/ path for %s', (src) => {
    expect(isArticleUrl('https://example.com/category/finance/', src)).toBe(false);
  });

  it.each(sources)('rejects /search/ path for %s', (src) => {
    expect(isArticleUrl('https://example.com/search?q=stocks', src)).toBe(false);
  });

  it.each(sources)('rejects /video/ path for %s', (src) => {
    expect(isArticleUrl('https://example.com/video/market-recap/', src)).toBe(false);
  });

  it('does NOT reject /finance/section-by-section/report (no segment boundary match)', () => {
    // The deny regex must be anchored at segment boundaries — partial matches don't count.
    // Uses apnews (pass-through source) since reuters now has an explicit allowlist.
    expect(
      isArticleUrl('https://example.com/finance/section-by-section/report', 'apnews'),
    ).toBe(true);
  });
});

describe('isArticleUrl — CNBC allowlist', () => {
  it('accepts date-slug article URL', () => {
    expect(
      isArticleUrl('https://www.cnbc.com/2026/04/22/fed-holds-rates.html', 'cnbc'),
    ).toBe(true);
  });

  it('rejects CNBC section index URL', () => {
    expect(isArticleUrl('https://www.cnbc.com/section/markets/', 'cnbc')).toBe(false);
  });

  it('rejects CNBC author page', () => {
    expect(isArticleUrl('https://www.cnbc.com/author/jane-doe/', 'cnbc')).toBe(false);
  });

  it('rejects CNBC live-tv page', () => {
    expect(isArticleUrl('https://www.cnbc.com/live-tv/', 'cnbc')).toBe(false);
  });

  it('rejects CNBC URL that lacks a date prefix', () => {
    // /markets/inside-markets.html — no date, should fail allowlist
    expect(isArticleUrl('https://www.cnbc.com/markets/inside-markets.html', 'cnbc')).toBe(
      false,
    );
  });
});

describe('isArticleUrl — yahoo-finance allowlist', () => {
  it('accepts /news/slug-12345678.html (numeric ID shape)', () => {
    expect(
      isArticleUrl(
        'https://finance.yahoo.com/news/fed-holds-rates-12345678.html',
        'yahoo-finance',
      ),
    ).toBe(true);
  });

  it('accepts /news/slug-without-numeric-id.html (non-numeric slug)', () => {
    // Loosened regex — numeric ID not required
    expect(
      isArticleUrl(
        'https://finance.yahoo.com/news/markets-wrap-afternoon.html',
        'yahoo-finance',
      ),
    ).toBe(true);
  });

  it('accepts legacy /<slug>-NNNN.html shape outside /news/', () => {
    expect(
      isArticleUrl(
        'https://finance.yahoo.com/fed-holds-rates-98765432.html',
        'yahoo-finance',
      ),
    ).toBe(true);
  });

  it('rejects yahoo-finance section page', () => {
    expect(
      isArticleUrl('https://finance.yahoo.com/topic/markets/', 'yahoo-finance'),
    ).toBe(false);
  });
});

describe('isArticleUrl — pass-through sources (no allowlist)', () => {
  it('accepts a normal apnews article URL', () => {
    expect(
      isArticleUrl('https://apnews.com/article/federal-reserve-abc123', 'apnews'),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §M3.1 — per-source allowlists for re-qualified outlets
// ---------------------------------------------------------------------------

describe('isArticleUrl — reuters allowlist (§M3.1)', () => {
  it('accepts slug ending with -YYYY-MM-DD', () => {
    expect(
      isArticleUrl(
        'https://www.reuters.com/markets/us/fed-holds-rates-2026-04-22/',
        'reuters',
      ),
    ).toBe(true);
  });

  it('accepts deep path slug ending with -YYYY-MM-DD', () => {
    expect(
      isArticleUrl(
        'https://www.reuters.com/world/europe/ecb-holds-rates-2026-04-21',
        'reuters',
      ),
    ).toBe(true);
  });

  it('rejects reuters section index without date suffix', () => {
    expect(isArticleUrl('https://www.reuters.com/markets/us/', 'reuters')).toBe(false);
  });

  it('rejects reuters /author/ path via global deny', () => {
    expect(isArticleUrl('https://www.reuters.com/author/jane-doe/', 'reuters')).toBe(
      false,
    );
  });
});

describe('isArticleUrl — marketwatch allowlist (§M3.1)', () => {
  it('accepts /story/<slug>', () => {
    expect(
      isArticleUrl(
        'https://www.marketwatch.com/story/fed-holds-rates-abc123',
        'marketwatch',
      ),
    ).toBe(true);
  });

  it('rejects marketwatch path without /story/ prefix', () => {
    expect(
      isArticleUrl('https://www.marketwatch.com/investing/bonds/', 'marketwatch'),
    ).toBe(false);
  });

  it('rejects marketwatch /video/ path via global deny', () => {
    expect(
      isArticleUrl('https://www.marketwatch.com/video/market-recap/', 'marketwatch'),
    ).toBe(false);
  });
});

describe('isArticleUrl — benzinga allowlist (§M3.1)', () => {
  it('accepts /news/YY/MM/<id> path', () => {
    expect(
      isArticleUrl(
        'https://www.benzinga.com/news/26/04/40906819/fed-holds-rates',
        'benzinga',
      ),
    ).toBe(true);
  });

  it('rejects benzinga path without /news/YY/MM/<id> shape', () => {
    expect(isArticleUrl('https://www.benzinga.com/general/markets/', 'benzinga')).toBe(
      false,
    );
  });

  it('rejects benzinga /tag/ path via global deny', () => {
    expect(isArticleUrl('https://www.benzinga.com/tag/economy/', 'benzinga')).toBe(false);
  });
});

describe('isArticleUrl — investing allowlist (§M3.1)', () => {
  it('accepts /news/<category>/<slug>-<id> path', () => {
    expect(
      isArticleUrl(
        'https://www.investing.com/news/economy/fed-holds-rates-3781723',
        'investing',
      ),
    ).toBe(true);
  });

  it('rejects investing /news/ path without numeric ID suffix', () => {
    expect(isArticleUrl('https://www.investing.com/news/economy/', 'investing')).toBe(
      false,
    );
  });

  it('rejects investing /analysis/ path (not in allowlist)', () => {
    expect(isArticleUrl('https://www.investing.com/analysis/slug-123', 'investing')).toBe(
      false,
    );
  });

  it('rejects investing /category/ path via global deny', () => {
    expect(isArticleUrl('https://www.investing.com/category/economy/', 'investing')).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// §M3.1 — JS-aware seed wait behavior
// ---------------------------------------------------------------------------

describe('makeDiscovery — JS-aware seed wait (§M3.1)', () => {
  const SOURCE_ID = 'bbbbbbbb-0000-0000-0000-000000000002';

  function makeJsWaitSource(externalId: string, seedUrl: string) {
    const sources = [{ id: SOURCE_ID, external_id: externalId, poll_interval_ms: null }];
    const seedConfigs = [{ id: 'seed-js', source_id: SOURCE_ID, seed_url: seedUrl }];
    return { sources, seedConfigs };
  }

  const JS_WAIT_SOURCES = ['reuters', 'investing', 'marketwatch', 'benzinga'];

  it.each(JS_WAIT_SOURCES)(
    'calls waitForSelector for JS-wait source: %s',
    async (externalId) => {
      // Each outlet needs a seed URL that itself is a valid article URL matching
      // the per-source allowlist so that at least one link survives isArticleUrl.
      // Seed URL shape is arbitrary for this test — we only verify the selector call.
      const seedUrl =
        externalId === 'reuters'
          ? 'https://www.reuters.com/news/'
          : externalId === 'marketwatch'
            ? 'https://www.marketwatch.com/latest-news/'
            : externalId === 'benzinga'
              ? 'https://www.benzinga.com/news/'
              : 'https://www.investing.com/news/';

      const { sources, seedConfigs } = makeJsWaitSource(externalId, seedUrl);
      const db = makeTestDb(sources, seedConfigs);
      const browser = makeTestBrowser(new Map([[seedUrl, []]]), {
        trackWaitForSelector: true,
      });

      const discovery = makeDiscovery({
        db: db as any,
        browser,
        logger: makeNullLogger(),
        tracer: makeNullTracer(),
      });

      await discovery.runOnce();

      const calls = (browser as any)._waitForSelectorCalls as Array<{
        selector: string;
        url: string;
      }>;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0]!.selector).toBe('main a[href]');
    },
  );

  it('does NOT call waitForSelector for pass-through source apnews', async () => {
    const seedUrl = 'https://apnews.com/finance/';
    const sources = [{ id: SOURCE_ID, external_id: 'apnews', poll_interval_ms: null }];
    const seedConfigs = [{ id: 'seed-ap', source_id: SOURCE_ID, seed_url: seedUrl }];
    const db = makeTestDb(sources, seedConfigs);
    const browser = makeTestBrowser(new Map([[seedUrl, []]]), {
      trackWaitForSelector: true,
    });

    const discovery = makeDiscovery({
      db: db as any,
      browser,
      logger: makeNullLogger(),
      tracer: makeNullTracer(),
    });

    await discovery.runOnce();

    const calls = (browser as any)._waitForSelectorCalls as Array<unknown>;
    expect(calls.length).toBe(0);
  });
});
