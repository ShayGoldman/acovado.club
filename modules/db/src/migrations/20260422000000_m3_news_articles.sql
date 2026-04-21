-- M3: news_articles table — stores full-content Playwright fetch results.
-- Additive only — no existing tables modified.

CREATE TABLE IF NOT EXISTS acovado.news_articles (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id      UUID         NOT NULL REFERENCES acovado.sources(id),
  url            TEXT         NOT NULL,
  title          TEXT,
  extracted_body TEXT,
  -- SHA-256 hex of rendered HTML. NOT unique: same content may appear at different URLs.
  -- Uniqueness is on url only (see UNIQUE constraint below).
  html_hash      VARCHAR(64),
  -- 'success' | 'extract_failed' | 'error'
  -- Error-path rows are inserted with fetch_status='error' so the candidate query
  -- (seen_urls LEFT JOIN news_articles WHERE na.id IS NULL) drops them from retries.
  fetch_status   VARCHAR(32)  NOT NULL,
  error_message  TEXT,
  fetched_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (url)
);
