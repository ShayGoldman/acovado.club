-- Create acovado schema and all core tables.

CREATE SCHEMA IF NOT EXISTS acovado;

-- sources — data sources (subreddits, youtube channels, etc.)
CREATE TABLE IF NOT EXISTS acovado.sources (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        VARCHAR(32)  NOT NULL,
  external_id VARCHAR(256) NOT NULL,
  display_name VARCHAR(256),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (kind, external_id)
);

-- tickers — known ticker symbols
CREATE TABLE IF NOT EXISTS acovado.tickers (
  symbol       VARCHAR(16)  PRIMARY KEY,
  display_name VARCHAR(128),
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

-- content_items — collected posts and videos
CREATE TABLE IF NOT EXISTS acovado.content_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id    UUID NOT NULL REFERENCES acovado.sources(id),
  external_id  VARCHAR(256) NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT,
  url          TEXT NOT NULL,
  published_at TIMESTAMP NOT NULL,
  processed_at TIMESTAMP,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, external_id)
);

-- mentions — ticker symbols extracted from content items
CREATE TABLE IF NOT EXISTS acovado.mentions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id UUID NOT NULL REFERENCES acovado.content_items(id),
  ticker_symbol   VARCHAR(16) NOT NULL,
  confidence      VARCHAR(16) NOT NULL,
  is_explicit     BOOLEAN NOT NULL DEFAULT FALSE,
  raw_context     TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- inference_logs — LLM invocation audit trail
CREATE TABLE IF NOT EXISTS acovado.inference_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(256),
  model       VARCHAR(128) NOT NULL,
  config      JSONB,
  prompt      TEXT NOT NULL,
  response    TEXT,
  duration_ms VARCHAR(32) NOT NULL,
  status      VARCHAR(16) NOT NULL,
  error       TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  metadata    JSONB,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
