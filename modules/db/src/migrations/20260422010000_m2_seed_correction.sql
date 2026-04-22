-- M2 seed correction — remove paywall sources (bloomberg/wsj/ft), seed PRD §5 approved sources.
-- Filename uses 20260422010000 (not 20260422000000) to avoid collision with m3_news_articles.sql.

-- Remove seen_urls attributed to the wrong sources
DELETE FROM acovado.seen_urls
WHERE discovered_by_source_id IN (
  SELECT id FROM acovado.sources
  WHERE kind = 'news' AND external_id IN ('bloomberg', 'wsj', 'ft')
);

-- Remove news_articles attributed to the wrong sources
DELETE FROM acovado.news_articles
WHERE source_id IN (
  SELECT id FROM acovado.sources
  WHERE kind = 'news' AND external_id IN ('bloomberg', 'wsj', 'ft')
);

-- Remove configs for the wrong sources
DELETE FROM acovado.news_source_configs
WHERE source_id IN (
  SELECT id FROM acovado.sources
  WHERE kind = 'news' AND external_id IN ('bloomberg', 'wsj', 'ft')
);

-- Remove the wrong sources
DELETE FROM acovado.sources
WHERE kind = 'news' AND external_id IN ('bloomberg', 'wsj', 'ft');

-- Seed the three missing PRD §5 approved sources (idempotent)
INSERT INTO acovado.sources (kind, external_id, display_name) VALUES
  ('news', 'apnews',    'AP News'),
  ('news', 'benzinga',  'Benzinga'),
  ('news', 'investing', 'Investing.com')
ON CONFLICT (kind, external_id) DO NOTHING;

-- Seed configs for the new sources
INSERT INTO acovado.news_source_configs (source_id, seed_url)
SELECT s.id, c.seed_url
FROM (VALUES
  ('apnews',    'https://apnews.com/hub/financial-markets'),
  ('benzinga',  'https://www.benzinga.com/news/markets/'),
  ('investing', 'https://www.investing.com/news/stock-market-news')
) AS c(external_id, seed_url)
JOIN acovado.sources s ON s.kind = 'news' AND s.external_id = c.external_id
ON CONFLICT (source_id, seed_url) DO NOTHING;
