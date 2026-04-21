import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Tracker parameter stripping
// ---------------------------------------------------------------------------

/** Exact-match keys always stripped regardless of value. */
const LITERAL_STRIP_KEYS = new Set([
  'ref',
  'referrer',
  'source',
  'campaign',
  'medium',
  'content',
  'fbclid',
  'gclid',
  '_hsenc',
  '_hsmi',
  'msclkid',
]);

/** Key prefixes — any param whose name starts with one of these is stripped. */
const PREFIX_STRIP = ['utm_', 'mc_'];

function isTrackerParam(key: string): boolean {
  if (LITERAL_STRIP_KEYS.has(key)) return true;
  for (const prefix of PREFIX_STRIP) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Lightweight eTLD+1 extractor — no external dependency.
// Sufficient for the fixed v1 source list (covers standard 2-part + known
// 3-part public suffixes like co.uk, com.au).
// ---------------------------------------------------------------------------

const THREE_PART_SUFFIXES = new Set([
  'co.uk',
  'co.in',
  'co.jp',
  'co.nz',
  'co.za',
  'co.kr',
  'com.au',
  'com.br',
  'com.sg',
  'com.hk',
  'com.mx',
  'net.au',
  'org.uk',
  'gov.uk',
]);

export function getEtld1(hostname: string): string {
  const parts = hostname.toLowerCase().split('.');
  if (parts.length <= 2) return hostname.toLowerCase();
  const twoSuffix = parts.slice(-2).join('.');
  if (THREE_PART_SUFFIXES.has(twoSuffix) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

// ---------------------------------------------------------------------------
// Core normalizer
// ---------------------------------------------------------------------------

/**
 * Applies the §2 normalization rules in order and returns the normalized URL
 * string, or null if the URL should be discarded (unparseable / cross-domain).
 */
export function normalizeUrl(href: string, seedPageUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(href, seedPageUrl);
  } catch {
    return null;
  }

  // Rule 2: lowercase scheme + host
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();

  // Rule 3: strip fragment
  url.hash = '';

  // Rule 4: strip tracker query parameters
  const keysToDelete: string[] = [];
  for (const key of url.searchParams.keys()) {
    if (isTrackerParam(key)) keysToDelete.push(key);
  }
  for (const key of keysToDelete) url.searchParams.delete(key);

  // Rule 5: sort remaining query parameters alphabetically
  url.searchParams.sort();

  // Rule 6: strip trailing slash from path (unless path is exactly '/')
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }

  // Rule 7: same-domain filter — discard if eTLD+1 differs from seed
  const seedEtld1 = getEtld1(new URL(seedPageUrl).hostname);
  const candidateEtld1 = getEtld1(url.hostname);
  if (candidateEtld1 !== seedEtld1) return null;

  return url.toString();
}

/** SHA-256 hex hash of the normalized URL string. */
export function hashUrl(normalizedUrl: string): string {
  return crypto.createHash('sha256').update(normalizedUrl).digest('hex');
}
