import { describe, expect, it } from 'bun:test';
import { getEtld1, hashUrl, normalizeUrl } from './normalize-url';

const SEED = 'https://finance.yahoo.com/news/';

// ---------------------------------------------------------------------------
// Literal-key tracker stripping
// ---------------------------------------------------------------------------
describe('normalizeUrl — literal tracker key stripping', () => {
  const cases: Array<[string, string]> = [
    ['ref', 'https://finance.yahoo.com/news/article?ref=homepage'],
    ['referrer', 'https://finance.yahoo.com/news/article?referrer=google'],
    ['source', 'https://finance.yahoo.com/news/article?source=rss'],
    ['campaign', 'https://finance.yahoo.com/news/article?campaign=email'],
    ['medium', 'https://finance.yahoo.com/news/article?medium=cpc'],
    ['content', 'https://finance.yahoo.com/news/article?content=banner'],
    ['fbclid', 'https://finance.yahoo.com/news/article?fbclid=IwAR0abc123'],
    ['gclid', 'https://finance.yahoo.com/news/article?gclid=abc123'],
    ['_hsenc', 'https://finance.yahoo.com/news/article?_hsenc=p2ANqtz-9X'],
    ['_hsmi', 'https://finance.yahoo.com/news/article?_hsmi=12345'],
    ['msclkid', 'https://finance.yahoo.com/news/article?msclkid=abc123xyz'],
  ];

  for (const [key, url] of cases) {
    it(`strips "${key}" from query string`, () => {
      const result = normalizeUrl(url, SEED);
      expect(result).not.toBeNull();
      expect(new URL(result!).searchParams.has(key)).toBe(false);
    });
  }

  it('strips multiple literal keys in a single URL', () => {
    const url =
      'https://finance.yahoo.com/news/article?ref=home&fbclid=abc&gclid=xyz&q=stocks';
    const result = normalizeUrl(url, SEED);
    expect(result).not.toBeNull();
    const params = new URL(result!).searchParams;
    expect(params.has('ref')).toBe(false);
    expect(params.has('fbclid')).toBe(false);
    expect(params.has('gclid')).toBe(false);
    expect(params.get('q')).toBe('stocks');
  });
});

// ---------------------------------------------------------------------------
// Prefix-match tracker stripping (utm_* and mc_*)
// ---------------------------------------------------------------------------
describe('normalizeUrl — prefix tracker param stripping', () => {
  const utmCases: Array<[string, string]> = [
    ['utm_source', 'https://finance.yahoo.com/news/article?utm_source=twitter'],
    ['utm_medium', 'https://finance.yahoo.com/news/article?utm_medium=social'],
    ['utm_campaign', 'https://finance.yahoo.com/news/article?utm_campaign=q1'],
    ['utm_content', 'https://finance.yahoo.com/news/article?utm_content=hero'],
    ['utm_term', 'https://finance.yahoo.com/news/article?utm_term=stocks'],
    ['utm_id', 'https://finance.yahoo.com/news/article?utm_id=abc123'],
  ];

  for (const [key, url] of utmCases) {
    it(`strips utm_ prefix param "${key}"`, () => {
      const result = normalizeUrl(url, SEED);
      expect(result).not.toBeNull();
      expect(new URL(result!).searchParams.has(key)).toBe(false);
    });
  }

  const mcCases: Array<[string, string]> = [
    ['mc_cid', 'https://finance.yahoo.com/news/article?mc_cid=abc123'],
    ['mc_eid', 'https://finance.yahoo.com/news/article?mc_eid=def456'],
  ];

  for (const [key, url] of mcCases) {
    it(`strips mc_ prefix param "${key}"`, () => {
      const result = normalizeUrl(url, SEED);
      expect(result).not.toBeNull();
      expect(new URL(result!).searchParams.has(key)).toBe(false);
    });
  }

  it('strips all utm_ variants while preserving non-tracker params', () => {
    const url =
      'https://finance.yahoo.com/news/article?utm_source=twitter&utm_medium=social&ticker=AAPL';
    const result = normalizeUrl(url, SEED);
    expect(result).not.toBeNull();
    const params = new URL(result!).searchParams;
    expect(params.has('utm_source')).toBe(false);
    expect(params.has('utm_medium')).toBe(false);
    expect(params.get('ticker')).toBe('AAPL');
  });
});

// ---------------------------------------------------------------------------
// Fragment stripping
// ---------------------------------------------------------------------------
describe('normalizeUrl — fragment stripping', () => {
  it('removes URL fragments', () => {
    const url = 'https://finance.yahoo.com/news/article#comments';
    const result = normalizeUrl(url, SEED);
    expect(result).not.toBeNull();
    expect(new URL(result!).hash).toBe('');
  });

  it('removes fragment combined with tracker params', () => {
    const url = 'https://finance.yahoo.com/news/article?utm_source=x#top';
    const result = normalizeUrl(url, SEED);
    expect(result).not.toBeNull();
    const parsed = new URL(result!);
    expect(parsed.hash).toBe('');
    expect(parsed.searchParams.has('utm_source')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Trailing slash normalization
// ---------------------------------------------------------------------------
describe('normalizeUrl — trailing slash', () => {
  it('strips trailing slash from non-root paths', () => {
    const url = 'https://finance.yahoo.com/news/article/';
    const result = normalizeUrl(url, SEED);
    expect(result).not.toBeNull();
    expect(new URL(result!).pathname).toBe('/news/article');
  });

  it('preserves root path slash', () => {
    const url = 'https://finance.yahoo.com/';
    const result = normalizeUrl(url, SEED);
    expect(result).not.toBeNull();
    expect(new URL(result!).pathname).toBe('/');
  });
});

// ---------------------------------------------------------------------------
// Query parameter sort (canonical ordering)
// ---------------------------------------------------------------------------
describe('normalizeUrl — query param sort', () => {
  it('produces the same normalized URL regardless of param order', () => {
    const url1 = 'https://finance.yahoo.com/news?z=last&a=first&m=middle';
    const url2 = 'https://finance.yahoo.com/news?a=first&m=middle&z=last';
    const r1 = normalizeUrl(url1, SEED);
    const r2 = normalizeUrl(url2, SEED);
    expect(r1).toEqual(r2);
  });
});

// ---------------------------------------------------------------------------
// Same-domain filter
// ---------------------------------------------------------------------------
describe('normalizeUrl — same-domain filter', () => {
  it('discards cross-domain links', () => {
    const url = 'https://www.cnbc.com/some/article';
    const result = normalizeUrl(url, SEED); // seed is finance.yahoo.com
    expect(result).toBeNull();
  });

  it('keeps same-eTLD+1 links across subdomains', () => {
    const seed = 'https://www.marketwatch.com/latest-news';
    const url = 'https://www.marketwatch.com/story/some-article-2024';
    const result = normalizeUrl(url, seed);
    expect(result).not.toBeNull();
  });

  it('discards links to popular trackers / social platforms', () => {
    const urls = [
      'https://twitter.com/share?url=x',
      'https://www.facebook.com/sharer/sharer.php',
      'https://www.google.com/search?q=stocks',
    ];
    for (const url of urls) {
      expect(normalizeUrl(url, SEED)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Relative URL resolution
// ---------------------------------------------------------------------------
describe('normalizeUrl — relative URL resolution', () => {
  it('resolves relative href against seed page origin', () => {
    const result = normalizeUrl('/news/article-abc', SEED);
    expect(result).not.toBeNull();
    expect(new URL(result!).hostname).toBe('finance.yahoo.com');
    expect(new URL(result!).pathname).toBe('/news/article-abc');
  });

  it('returns null for unparseable hrefs', () => {
    expect(normalizeUrl('javascript:void(0)', SEED)).toBeNull();
    expect(normalizeUrl('mailto:a@b.com', SEED)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Hash stability
// ---------------------------------------------------------------------------
describe('hashUrl', () => {
  it('produces the same hash for the same URL', () => {
    const url = 'https://finance.yahoo.com/news/article';
    expect(hashUrl(url)).toBe(hashUrl(url));
  });

  it('utm_source variant hashes to the same value as clean URL', () => {
    const clean = normalizeUrl('https://finance.yahoo.com/news/article', SEED)!;
    const dirty = normalizeUrl(
      'https://finance.yahoo.com/news/article?utm_source=twitter',
      SEED,
    )!;
    expect(hashUrl(clean)).toBe(hashUrl(dirty));
  });
});

// ---------------------------------------------------------------------------
// getEtld1 helper
// ---------------------------------------------------------------------------
describe('getEtld1', () => {
  it('extracts eTLD+1 for common v1 outlets', () => {
    expect(getEtld1('finance.yahoo.com')).toBe('yahoo.com');
    expect(getEtld1('www.cnbc.com')).toBe('cnbc.com');
    expect(getEtld1('www.marketwatch.com')).toBe('marketwatch.com');
    expect(getEtld1('www.reuters.com')).toBe('reuters.com');
    expect(getEtld1('www.bloomberg.com')).toBe('bloomberg.com');
    expect(getEtld1('www.wsj.com')).toBe('wsj.com');
    expect(getEtld1('www.ft.com')).toBe('ft.com');
    expect(getEtld1('seekingalpha.com')).toBe('seekingalpha.com');
  });

  it('handles co.uk three-part suffix', () => {
    expect(getEtld1('news.bbc.co.uk')).toBe('bbc.co.uk');
  });
});
