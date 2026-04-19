/**
 * SEC EDGAR ticker seed.
 *
 * Fetches company_tickers.json from SEC EDGAR (~10k equities) and
 * bulk-upserts into acovado.tickers. Safe to run multiple times (upsert).
 *
 * Usage: bun run seed  (from modules/db directory)
 * Requires: DATABASE_URL env var pointing to a running Postgres with migrations applied.
 */
import { makeLogger } from '@modules/logger';
import { makeTracer } from '@modules/tracing';
import Env from './env';
import { makeDBClient } from './client';
import { schema } from './schema';

interface SecTicker {
  cik_str: number;
  ticker: string;
  title: string;
}

const logger = makeLogger({ name: 'seed' });

async function seedTickers() {
  const tracer = makeTracer({
    serviceName: 'db-seed',
    exporterUrls: [],
    logExportEnabled: false,
    logger,
  });

  const db = makeDBClient({ url: Env.DATABASE_URL, tracer });

  logger.info('Fetching SEC EDGAR company_tickers.json...');

  const response = await fetch('https://www.sec.gov/files/company_tickers.json', {
    headers: {
      'User-Agent': 'Acovado acovado.club/1.0 (+https://acovado.club)',
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`SEC EDGAR fetch failed: ${response.status} ${response.statusText}`);
  }

  const raw = (await response.json()) as Record<string, SecTicker>;
  const entries = Object.values(raw);
  logger.info({ count: entries.length }, 'Fetched tickers from SEC EDGAR');

  const BATCH_SIZE = 500;
  let inserted = 0;

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE).map((entry) => ({
      symbol: entry.ticker.toUpperCase(),
      companyName: entry.title,
      cik: entry.cik_str.toString().padStart(10, '0'),
    }));

    await db
      .insert(schema.tickers)
      .values(batch)
      .onConflictDoNothing({ target: schema.tickers.symbol });

    inserted += batch.length;
    if (inserted % 2000 === 0 || inserted >= entries.length) {
      logger.info({ inserted, total: entries.length }, 'Seed progress');
    }
  }

  logger.info({ total: inserted }, 'SEC EDGAR seed complete');
  await tracer.shutdown();
}

seedTickers().catch((err) => {
  logger.error(err, 'Seed failed');
  process.exit(1);
});
