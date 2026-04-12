import type { DBClient } from '../client';

interface SecTicker {
  cik_str: number;
  ticker: string;
  title: string;
}

/**
 * Post-hook for 002-seed-tickers.sql.
 * Fetches SEC EDGAR company_tickers.json and bulk-inserts ~10k tickers.
 * Uses upsert (on conflict do nothing) so it is safe to re-run.
 */
export async function post(tx: DBClient) {
  console.log('[002-seed-tickers] Fetching SEC EDGAR company_tickers.json...');

  const response = await fetch('https://www.sec.gov/files/company_tickers.json', {
    headers: {
      'User-Agent': 'Acovado acovado.club/1.0 (+https://acovado.club)',
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch SEC EDGAR tickers: ${response.status} ${response.statusText}`,
    );
  }

  const raw = (await response.json()) as Record<string, SecTicker>;

  const entries = Object.values(raw);
  console.log(`[002-seed-tickers] Fetched ${entries.length} tickers from SEC EDGAR.`);

  // Batch inserts to avoid parameter limit (Postgres max ~65k)
  const BATCH_SIZE = 500;
  let inserted = 0;

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);

    const values = batch.map((entry) => ({
      symbol: entry.ticker.toUpperCase(),
      name: entry.title,
      cik: entry.cik_str.toString().padStart(10, '0'),
    }));

    await tx.execute(`
      INSERT INTO acovado.tickers (symbol, name, cik)
      SELECT
        t.symbol,
        t.name,
        t.cik
      FROM json_to_recordset('${JSON.stringify(values).replace(/'/g, "''")}') AS t(symbol TEXT, name TEXT, cik TEXT)
      ON CONFLICT (symbol) DO NOTHING;
    `);

    inserted += batch.length;
    if (inserted % 2000 === 0 || inserted >= entries.length) {
      console.log(
        `[002-seed-tickers] Progress: ${inserted}/${entries.length} tickers processed.`,
      );
    }
  }

  console.log(
    `[002-seed-tickers] SEC EDGAR seed complete. Processed ${entries.length} tickers.`,
  );
}
