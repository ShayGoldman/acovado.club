import type { Browser } from 'playwright';
import robotsParser from 'robots-parser';
import type { Logger } from '@modules/logger';
import type { Tracer } from '@modules/tracing';
import { makeBodyExtractor } from './body-extractor';

const BOT_USER_AGENT = 'AcovadoBot/1.0 (+https://acovado.club/bot)';
const DEFAULT_RATE_BUDGET_MS = 2_000;
const DEFAULT_NAV_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_ROBOTS_TTL_MS = 24 * 60 * 60 * 1_000;

// ---------------------------------------------------------------------------
// Narrow DB interface — real DBClient satisfies this; mocks do too in tests.
// ---------------------------------------------------------------------------

export interface ArticleFetcherDb {
  execute(query: string): Promise<Array<Record<string, unknown>>>;
}

export interface ArticleCandidate {
  url: string;
  sourceId: string;
  externalId: string;
}

export interface MakeArticleFetcherOpts {
  db: ArticleFetcherDb;
  browser: Browser;
  logger: Logger;
  tracer: Tracer;
  navTimeoutMs?: number;
  maxRetries?: number;
  concurrency?: number;
  robotsCacheTtlMs?: number;
  /** Process env for rate-budget resolution — defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

export type ArticleFetcher = ReturnType<typeof makeArticleFetcher>;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function makeArticleFetcher({
  db,
  browser,
  logger,
  tracer,
  navTimeoutMs = DEFAULT_NAV_TIMEOUT_MS,
  maxRetries = DEFAULT_MAX_RETRIES,
  concurrency = DEFAULT_CONCURRENCY,
  robotsCacheTtlMs = DEFAULT_ROBOTS_TTL_MS,
  env = process.env,
}: MakeArticleFetcherOpts) {
  const extractor = makeBodyExtractor();

  // robots.txt in-memory cache: domain → { allowed: boolean; crawlDelayMs: number | null; expiresAt: number }
  const robotsCache = new Map<
    string,
    { allowed: boolean; crawlDelayMs: number | null; expiresAt: number }
  >();

  // Per-source rate bucket: sourceId → tail of the promise chain (serialize requests).
  const rateBuckets = new Map<string, Promise<void>>();
  const lastAcquiredAt = new Map<string, number>();

  // ---------------------------------------------------------------------------
  // robots.txt helpers
  // ---------------------------------------------------------------------------

  function rateBudgetMs(externalId: string): number {
    const key = `NEWS_RATE_BUDGET_${externalId.toUpperCase().replace(/-/g, '_')}_MS`;
    const val = env[key];
    if (val && /^\d+$/.test(val)) return Number.parseInt(val, 10);
    return DEFAULT_RATE_BUDGET_MS;
  }

  async function fetchRobots(
    domain: string,
  ): Promise<{ allowed: boolean; crawlDelayMs: number | null }> {
    const cached = robotsCache.get(domain);
    if (cached && Date.now() < cached.expiresAt) {
      return { allowed: cached.allowed, crawlDelayMs: cached.crawlDelayMs };
    }

    const robotsUrl = `${domain}/robots.txt`;
    let allowed = true;
    let crawlDelayMs: number | null = null;

    try {
      const resp = await fetch(robotsUrl, {
        headers: { 'User-Agent': BOT_USER_AGENT },
        signal: AbortSignal.timeout(10_000),
      });
      if (resp.ok) {
        const body = await resp.text();
        const robots = robotsParser(robotsUrl, body);
        allowed = robots.isAllowed(robotsUrl, BOT_USER_AGENT) !== false;
        const delay = robots.getCrawlDelay(BOT_USER_AGENT);
        if (delay != null) crawlDelayMs = Math.round(delay * 1_000);
      } else {
        // Non-200 (403, 404, etc.) — permissive fallback.
        logger.warn(
          { domain, status: resp.status },
          'news.robots.fetch_non200: treating as allow-all',
        );
      }
    } catch (err) {
      // Network failure — permissive fallback.
      logger.warn({ err, domain }, 'news.robots.fetch_error: treating as allow-all');
    }

    robotsCache.set(domain, {
      allowed,
      crawlDelayMs,
      expiresAt: Date.now() + robotsCacheTtlMs,
    });
    return { allowed, crawlDelayMs };
  }

  // ---------------------------------------------------------------------------
  // Rate bucket
  // ---------------------------------------------------------------------------

  function acquireRateBudget(sourceId: string, externalId: string): Promise<void> {
    const budgetMs = rateBudgetMs(externalId);
    const tail = rateBuckets.get(sourceId) ?? Promise.resolve();
    const next = tail
      .then(() => {
        const now = Date.now();
        const last = lastAcquiredAt.get(sourceId) ?? 0;
        const waitMs = Math.max(0, last + budgetMs - now);
        return new Promise<void>((resolve) => setTimeout(resolve, waitMs));
      })
      .then(() => {
        lastAcquiredAt.set(sourceId, Date.now());
      });
    rateBuckets.set(sourceId, next);
    return next;
  }

  // ---------------------------------------------------------------------------
  // Candidate query
  // ---------------------------------------------------------------------------

  async function fetchCandidates(): Promise<ArticleCandidate[]> {
    // TODO: this LEFT JOIN anti-join degrades at scale as news_articles grows.
    // A partial index on seen_urls (e.g. WHERE url NOT IN (...)) or a status column
    // on seen_urls is the later fix; skipped for v1 single-worker architecture.
    const rows = await db.execute(`
      SELECT su.url, su.discovered_by_source_id AS source_id, s.external_id
      FROM acovado.seen_urls su
      LEFT JOIN acovado.news_articles na ON na.url = su.url
      JOIN acovado.sources s ON s.id = su.discovered_by_source_id
      WHERE na.id IS NULL
      ORDER BY su.first_seen_at ASC
      LIMIT 100
    `);
    return rows.map((r) => {
      const row = r as { url: string; source_id: string; external_id: string };
      return { url: row.url, sourceId: row.source_id, externalId: row.external_id };
    });
  }

  // ---------------------------------------------------------------------------
  // Article fetch (single URL, with retry)
  // ---------------------------------------------------------------------------

  async function fetchAndInsert(candidate: ArticleCandidate): Promise<void> {
    const { url, sourceId, externalId } = candidate;

    let domain: string;
    try {
      domain = new URL(url).origin;
    } catch {
      logger.warn({ url }, 'news.fetch.invalid_url');
      return;
    }

    const { allowed, crawlDelayMs } = await fetchRobots(domain);
    if (!allowed) {
      logger.info({ url, domain }, 'news.fetch.robots_disallowed: skipping');
      return;
    }

    // Respect robots Crawl-delay as a floor on the rate budget.
    const budgetFloor = crawlDelayMs ?? 0;
    const budgetMs = Math.max(rateBudgetMs(externalId), budgetFloor);

    // Override in-bucket budget when crawl-delay is higher.
    if (budgetFloor > rateBudgetMs(externalId)) {
      const tailKey = `${sourceId}__floor`;
      const tail = rateBuckets.get(tailKey) ?? Promise.resolve();
      const next = tail
        .then(() => {
          const now = Date.now();
          const last = lastAcquiredAt.get(tailKey) ?? 0;
          const waitMs = Math.max(0, last + budgetMs - now);
          return new Promise<void>((r) => setTimeout(r, waitMs));
        })
        .then(() => {
          lastAcquiredAt.set(tailKey, Date.now());
        });
      rateBuckets.set(tailKey, next);
      await next;
    } else {
      await acquireRateBudget(sourceId, externalId);
    }

    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await attemptFetch(url, sourceId);
        return;
      } catch (err) {
        lastErr = err;
        logger.warn({ err, url, attempt }, 'news.fetch.attempt_failed');
        if (attempt < maxRetries) {
          const base = 2_000;
          const jitter = Math.random() * 0.4 - 0.2;
          const delay = Math.round(base * 2 ** attempt * (1 + jitter));
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    // All attempts exhausted — write error row so the candidate query drops this URL.
    logger.error({ err: lastErr, url }, 'news.fetch.error: writing error row');
    const msg =
      lastErr instanceof Error ? lastErr.message.replace(/'/g, "''") : String(lastErr);
    await db.execute(`
      INSERT INTO acovado.news_articles
        (source_id, url, fetch_status, error_message, fetched_at)
      VALUES
        ('${sourceId}', '${url.replace(/'/g, "''")}', 'error', '${msg}', NOW())
      ON CONFLICT (url) DO NOTHING
    `);
  }

  async function attemptFetch(url: string, sourceId: string): Promise<void> {
    const page = await browser.newPage();
    try {
      await page.goto(url, { timeout: navTimeoutMs, waitUntil: 'domcontentloaded' });
      const title = (await page.title()).trim();
      const result = await extractor.extract(page);

      if (!result) {
        logger.warn({ url }, 'news.fetch.extract_failed');
        await db.execute(`
          INSERT INTO acovado.news_articles
            (source_id, url, title, fetch_status, fetched_at)
          VALUES
            ('${sourceId}', '${url.replace(/'/g, "''")}',
             '${title.replace(/'/g, "''")}', 'extract_failed', NOW())
          ON CONFLICT (url) DO NOTHING
        `);
        return;
      }

      const { text, htmlHash } = result;
      const bodyEscaped = text.replace(/'/g, "''");
      const titleEscaped = title.replace(/'/g, "''");
      const urlEscaped = url.replace(/'/g, "''");

      // Unique constraint is on url only — html_hash is NOT unique (same content
      // can appear at multiple URLs). ON CONFLICT DO NOTHING ensures idempotency.
      await db.execute(`
        INSERT INTO acovado.news_articles
          (source_id, url, title, extracted_body, html_hash, fetch_status, fetched_at)
        VALUES
          ('${sourceId}', '${urlEscaped}', '${titleEscaped}',
           '${bodyEscaped}', '${htmlHash}', 'success', NOW())
        ON CONFLICT (url) DO NOTHING
      `);

      logger.info({ url, bodyLen: text.length, htmlHash }, 'news.fetch.success');
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  // ---------------------------------------------------------------------------
  // Concurrency-bounded batch run
  // ---------------------------------------------------------------------------

  async function runOnce(): Promise<void> {
    const candidates = await tracer.with('news.fetch_candidates', async (ctx) => {
      const result = await fetchCandidates();
      ctx.annotate('candidate_count', result.length);
      return result;
    });

    if (candidates.length === 0) {
      logger.debug('news.fetch.no_candidates');
      return;
    }

    logger.info({ count: candidates.length }, 'news.fetch.starting_batch');

    // Process with concurrency limit via semaphore-style slot queue.
    const slots = Array.from({ length: concurrency }, () => Promise.resolve());
    let slotIndex = 0;

    const promises: Promise<void>[] = [];
    for (const candidate of candidates) {
      const slotIdx = slotIndex % concurrency;
      slotIndex++;
      const slot = slots[slotIdx]!;
      const next = slot.then(() =>
        tracer
          .with(
            'news.fetch_article',
            { attributes: { url: candidate.url, sourceId: candidate.sourceId } },
            () => fetchAndInsert(candidate),
          )
          .catch((err) => {
            logger.error({ err, url: candidate.url }, 'news.fetch.unhandled_error');
          }),
      );
      slots[slotIdx] = next;
      promises.push(next);
    }

    await Promise.all(promises);
    logger.info({ count: candidates.length }, 'news.fetch.batch_done');
  }

  return { runOnce };
}
