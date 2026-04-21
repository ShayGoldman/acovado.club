-- M2: news discovery + seen-URL store.
-- Additive only — no existing tables modified except the poll_interval_ms column on sources.

-- Add per-source cadence override to sources (NULL = use app default).
ALTER TABLE acovado.sources
  ADD COLUMN IF NOT EXISTS poll_interval_ms INTEGER;

-- news_source_configs — seed URL configuration for news sources.
CREATE TABLE IF NOT EXISTS acovado.news_source_configs (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id   UUID    NOT NULL REFERENCES acovado.sources(id),
  seed_url    TEXT    NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, seed_url)
);

-- seen_urls — persistent URL dedup store.
CREATE TABLE IF NOT EXISTS acovado.seen_urls (
  url_hash                VARCHAR(64)  PRIMARY KEY,
  url                     TEXT         NOT NULL,
  discovered_by_source_id UUID         NOT NULL REFERENCES acovado.sources(id),
  first_seen_at           TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS seen_urls_first_seen_at_idx
  ON acovado.seen_urls (first_seen_at);

-- Seed news sources (idempotent).
INSERT INTO acovado.sources (kind, external_id, display_name) VALUES
  ('news', 'cnbc',        'CNBC'),
  ('news', 'yahoo-finance', 'Yahoo Finance'),
  ('news', 'marketwatch', 'MarketWatch'),
  ('news', 'reuters',     'Reuters'),
  ('news', 'bloomberg',   'Bloomberg'),
  ('news', 'wsj',         'Wall Street Journal'),
  ('news', 'ft',          'Financial Times'),
  ('news', 'seeking-alpha', 'Seeking Alpha')
ON CONFLICT (kind, external_id) DO NOTHING;

-- Seed news_source_configs for each news source.
INSERT INTO acovado.news_source_configs (source_id, seed_url)
SELECT s.id, c.seed_url
FROM (VALUES
  ('cnbc',          'https://www.cnbc.com/finance/'),
  ('yahoo-finance', 'https://finance.yahoo.com/news/'),
  ('marketwatch',   'https://www.marketwatch.com/latest-news'),
  ('reuters',       'https://www.reuters.com/finance/'),
  ('bloomberg',     'https://www.bloomberg.com/markets'),
  ('wsj',           'https://www.wsj.com/news/markets'),
  ('ft',            'https://www.ft.com/markets'),
  ('seeking-alpha', 'https://seekingalpha.com/market-news')
) AS c(external_id, seed_url)
JOIN acovado.sources s ON s.kind = 'news' AND s.external_id = c.external_id
ON CONFLICT (source_id, seed_url) DO NOTHING;
