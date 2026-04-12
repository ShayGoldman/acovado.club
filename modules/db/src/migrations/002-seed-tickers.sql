-- Placeholder for ticker seed migration.
-- The actual seeding is performed by the post-hook (002-seed-tickers.ts),
-- which fetches SEC EDGAR company_tickers.json and bulk-inserts into acovado.tickers.
-- This SQL file is intentionally a no-op to satisfy the migration runner.
SELECT 1;
