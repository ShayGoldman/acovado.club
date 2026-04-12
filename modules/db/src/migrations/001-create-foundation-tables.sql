-- Milestone 1: Foundation tables for Acovado signal pipeline
-- Creates acovado schema + core tables: inference_logs, sources, tickers, content_items, mentions

CREATE SCHEMA IF NOT EXISTS acovado;

-- Inference logging (required by @modules/inference)
CREATE TABLE IF NOT EXISTS acovado.inference_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT,
  model       TEXT NOT NULL,
  config      JSONB,
  prompt      TEXT NOT NULL,
  response    JSONB,
  duration_ms NUMERIC NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('success', 'error')),
  error       TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  metadata    JSONB,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inference_logs_status_idx ON acovado.inference_logs (status);
CREATE INDEX IF NOT EXISTS inference_logs_model_idx ON acovado.inference_logs (model);
CREATE INDEX IF NOT EXISTS inference_logs_created_at_idx ON acovado.inference_logs (created_at);

-- Data sources (subreddits, YouTube channels)
CREATE TABLE IF NOT EXISTS acovado.sources (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       TEXT NOT NULL CHECK (kind IN ('subreddit', 'youtube_channel')),
  identifier TEXT NOT NULL,
  name       TEXT,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  metadata   JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS sources_kind_identifier_idx ON acovado.sources (kind, identifier);

-- Equity tickers (seeded from SEC EDGAR company_tickers.json)
CREATE TABLE IF NOT EXISTS acovado.tickers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol     TEXT NOT NULL,
  name       TEXT NOT NULL,
  cik        TEXT,
  exchange   TEXT,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS tickers_symbol_idx ON acovado.tickers (symbol);
CREATE INDEX IF NOT EXISTS tickers_active_idx ON acovado.tickers (active);

-- Content items (Reddit posts/comments, YouTube videos/comments)
CREATE TABLE IF NOT EXISTS acovado.content_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id    UUID NOT NULL REFERENCES acovado.sources (id),
  external_id  TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('reddit_post', 'reddit_comment', 'youtube_video', 'youtube_comment')),
  title        TEXT,
  body         TEXT,
  author       TEXT,
  url          TEXT,
  score        INTEGER,
  published_at TIMESTAMP,
  processed_at TIMESTAMP,
  metadata     JSONB,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS content_items_source_external_idx ON acovado.content_items (source_id, external_id);
CREATE INDEX IF NOT EXISTS content_items_source_id_idx ON acovado.content_items (source_id);
CREATE INDEX IF NOT EXISTS content_items_published_at_idx ON acovado.content_items (published_at);
CREATE INDEX IF NOT EXISTS content_items_processed_at_idx ON acovado.content_items (processed_at);

-- Ticker mentions extracted from content items
CREATE TABLE IF NOT EXISTS acovado.mentions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id UUID NOT NULL REFERENCES acovado.content_items (id),
  ticker_id       UUID NOT NULL REFERENCES acovado.tickers (id),
  confidence      NUMERIC NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  is_explicit     BOOLEAN NOT NULL,
  context         TEXT,
  extracted_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mentions_content_item_id_idx ON acovado.mentions (content_item_id);
CREATE INDEX IF NOT EXISTS mentions_ticker_id_idx ON acovado.mentions (ticker_id);
CREATE INDEX IF NOT EXISTS mentions_extracted_at_idx ON acovado.mentions (extracted_at);
