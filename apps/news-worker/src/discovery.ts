import type { Browser } from 'playwright';
import type { Logger } from '@modules/logger';
import type { Tracer } from '@modules/tracing';
import { hashUrl, normalizeUrl } from './normalize-url';

const DEFAULT_POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const PLAYWRIGHT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 5_000;

// ---------------------------------------------------------------------------
// URL-shape filter (§12c)
// ---------------------------------------------------------------------------

// Layer 1 — global deny: section indexes, author pages, live-blogs, tag/topic pages,
// category pages, search, and pure-video pages. Anchored at path-segment boundaries
// so a segment like /finance/section-by-section/... is NOT wrongly dropped.
// Trailing (?:\/|$) also matches paths that end without a slash (e.g. /search at EOS).
const GLOBAL_DENY =
  /(?:^|\/)(?:section|author|live-updates|live-tv|tag|topic|category|search|video)(?:\/|$)/;

// Layer 2 — per-source article-path allowlist. Sources absent from this map
// pass through after Layer 1 only. yahoo-finance accepts multiple URL shapes
// (not just trailing numeric-ID .html) so the allowlist is intentionally broad.
const SOURCE_URL_ALLOWLIST: Record<string, RegExp[]> = {
  cnbc: [
    /\/\d{4}\/\d{2}\/\d{2}\/[^/]+\.html$/, // /2026/04/22/slug.html
  ],
  'yahoo-finance': [
    /\/news\/[^/]+/, // /news/<any-slug> (any extension, with or without trailing slash)
    /\/[^/]+-\d+\.html$/, // /<slug>-12345678.html (legacy shape outside /news/)
  ],
};

export function isArticleUrl(url: string, externalId: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }

  // Layer 1: global deny patterns.
  if (GLOBAL_DENY.test(pathname)) return false;

  // Layer 2: per-source allowlist (only applied to sources with an entry).
  const allowlist = SOURCE_URL_ALLOWLIST[externalId];
  if (allowlist) {
    return allowlist.some((re) => re.test(pathname));
  }

  return true;
}

// ---------------------------------------------------------------------------
// Narrow DB interface — real DBClient satisfies this; mocks do too in tests.
// ---------------------------------------------------------------------------

export interface DiscoverySource {
  id: string;
  externalId: string;
  pollIntervalMs: number | null;
}

export interface DiscoverySeedConfig {
  id: string;
  sourceId: string;
  seedUrl: string;
}

export interface DiscoveryDb {
  execute(query: string): Promise<Array<Record<string, unknown>>>;
}

export interface MakeDiscoveryOpts {
  db: DiscoveryDb;
  browser: Browser;
  logger: Logger;
  tracer: Tracer;
}

export type Discovery = ReturnType<typeof makeDiscovery>;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function makeDiscovery({ db, browser, logger, tracer }: MakeDiscoveryOpts) {
  // Last-polled timestamps keyed by source ID — in-process cadence tracking.
  const lastPolledAt = new Map<string, number>();

  async function fetchActiveSources(): Promise<DiscoverySource[]> {
    const rows = await db.execute(`
      SELECT id, external_id, poll_interval_ms
      FROM acovado.sources
      WHERE kind = 'news' AND active = true
    `);
    return rows.map((r) => {
      const row = r as {
        id: string;
        external_id: string;
        poll_interval_ms: number | null;
      };
      return {
        id: row.id,
        externalId: row.external_id,
        pollIntervalMs: row.poll_interval_ms,
      };
    });
  }

  async function fetchSeedConfigs(sourceId: string): Promise<DiscoverySeedConfig[]> {
    // sourceId is a UUID from our own DB.
    const rows = await db.execute(`
      SELECT id, source_id, seed_url
      FROM acovado.news_source_configs
      WHERE source_id = '${sourceId}' AND active = true
    `);
    return rows.map((r) => {
      const row = r as { id: string; source_id: string; seed_url: string };
      return { id: row.id, sourceId: row.source_id, seedUrl: row.seed_url };
    });
  }

  async function extractLinksFromPage(seedUrl: string): Promise<string[]> {
    const page = await browser.newPage();
    try {
      await page.goto(seedUrl, {
        timeout: PLAYWRIGHT_TIMEOUT_MS,
        waitUntil: 'domcontentloaded',
      });
      const hrefs = await page.$$eval('a[href]', (anchors) =>
        anchors.map((a) => (a as unknown as { href: string }).href),
      );
      return hrefs;
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  async function extractLinksWithRetry(seedUrl: string): Promise<string[]> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await extractLinksFromPage(seedUrl);
      } catch (err) {
        lastErr = err;
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        }
      }
    }
    throw lastErr;
  }

  async function lookupSeenHashes(hashes: string[]): Promise<Set<string>> {
    if (hashes.length === 0) return new Set();
    // Parameterised via literal list — values are SHA-256 hex strings (no user input).
    const list = hashes.map((h) => `'${h}'`).join(',');
    const rows = await db.execute(`
      SELECT url_hash FROM acovado.seen_urls WHERE url_hash IN (${list})
    `);
    return new Set(rows.map((r) => (r as { url_hash: string }).url_hash));
  }

  async function batchInsertSeenUrls(
    entries: Array<{ urlHash: string; url: string; sourceId: string }>,
  ): Promise<void> {
    if (entries.length === 0) return;
    const values = entries
      .map((e) => `('${e.urlHash}', '${e.url.replace(/'/g, "''")}', '${e.sourceId}')`)
      .join(',\n      ');
    await db.execute(`
      INSERT INTO acovado.seen_urls (url_hash, url, discovered_by_source_id)
      VALUES
        ${values}
      ON CONFLICT (url_hash) DO NOTHING
    `);
  }

  async function pollSeedUrl(
    source: DiscoverySource,
    seedUrl: string,
  ): Promise<{ candidates: number; newUrls: number }> {
    const rawHrefs = await extractLinksWithRetry(seedUrl);

    // Normalize + same-domain filter + article-URL shape filter
    const candidates: Array<{ urlHash: string; url: string }> = [];
    for (const href of rawHrefs) {
      const normalized = normalizeUrl(href, seedUrl);
      if (!normalized) continue;
      if (!isArticleUrl(normalized, source.externalId)) continue;
      candidates.push({ urlHash: hashUrl(normalized), url: normalized });
    }

    // Dedup hashes within this tick's candidate set
    const dedupedMap = new Map<string, string>();
    for (const { urlHash, url } of candidates) {
      dedupedMap.set(urlHash, url);
    }
    const uniqueCandidates = Array.from(dedupedMap.entries()).map(([urlHash, url]) => ({
      urlHash,
      url,
    }));

    if (uniqueCandidates.length === 0) {
      return { candidates: 0, newUrls: 0 };
    }

    // Batch lookup against seen_urls
    const seenHashes = await lookupSeenHashes(uniqueCandidates.map((c) => c.urlHash));
    const newEntries = uniqueCandidates
      .filter((c) => !seenHashes.has(c.urlHash))
      .map((c) => ({ ...c, sourceId: source.id }));

    // Batch insert
    await batchInsertSeenUrls(newEntries);

    return { candidates: uniqueCandidates.length, newUrls: newEntries.length };
  }

  async function pollSource(source: DiscoverySource): Promise<void> {
    const seeds = await fetchSeedConfigs(source.id);
    if (seeds.length === 0) {
      logger.warn({ sourceId: source.id }, 'news.source.no_seeds');
      return;
    }

    for (const seed of seeds) {
      try {
        const { candidates, newUrls } = await tracer.with(
          'news.poll_seed',
          { attributes: { sourceId: source.id, seedUrl: seed.seedUrl } },
          async (ctx) => {
            const result = await pollSeedUrl(source, seed.seedUrl);
            ctx.annotate('candidates', result.candidates);
            ctx.annotate('new_urls', result.newUrls);
            return result;
          },
        );
        logger.info(
          { source: source.externalId, seedUrl: seed.seedUrl, candidates, new: newUrls },
          'news.tick.done',
        );
      } catch (err) {
        logger.error(
          { err, source: source.externalId, seedUrl: seed.seedUrl },
          'news.seed.error',
        );
      }
    }
  }

  async function runOnce(): Promise<void> {
    const sources = await tracer.with('news.fetch_sources', async (ctx) => {
      const result = await fetchActiveSources();
      ctx.annotate('source_count', result.length);
      return result;
    });

    const now = Date.now();

    for (const source of sources) {
      const intervalMs = source.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
      const last = lastPolledAt.get(source.id) ?? 0;
      if (now - last < intervalMs) {
        logger.debug(
          { source: source.externalId, nextInMs: intervalMs - (now - last) },
          'news.source.skipped_cadence',
        );
        continue;
      }

      try {
        await pollSource(source);
        lastPolledAt.set(source.id, Date.now());
      } catch (err) {
        logger.error({ err, source: source.externalId }, 'news.source.error');
      }
    }
  }

  return { runOnce };
}
