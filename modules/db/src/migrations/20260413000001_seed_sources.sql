-- Seed initial signal sources (idempotent — ON CONFLICT DO NOTHING).

INSERT INTO acovado.sources (kind, external_id, display_name) VALUES
  ('reddit',  'wallstreetbets', 'r/wallstreetbets'),
  ('reddit',  'stocks',         'r/stocks'),
  ('reddit',  'investing',      'r/investing'),
  ('reddit',  'pennystocks',    'r/pennystocks'),
  ('youtube', '@Micha.Stocks',  'Micha Stocks')
ON CONFLICT (kind, external_id) DO NOTHING;
