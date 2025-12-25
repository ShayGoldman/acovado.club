import type { Logger } from '@modules/logger';

const MAX_RETRY_DELAY_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_RETRY_DELAY_MS = 10 * 60 * 1000; // 10 minutes

export interface RateLimitInfo {
  delayMs: number;
  retryAfter?: number;
  resetAt?: number;
}

export interface CalculateRetryDelayOpts {
  response: Response;
  retryCount: number;
  logger: Logger;
}

export function calculateRetryDelay(opts: CalculateRetryDelayOpts): RateLimitInfo {
  const { response, retryCount, logger } = opts;

  // Parse X-RateLimit-Reset header (Unix timestamp in seconds)
  const rateLimitResetHeader = response.headers.get('X-RateLimit-Reset');
  let resetAt: number | undefined;
  let delayFromReset: number | undefined;

  if (rateLimitResetHeader) {
    const resetTimestamp = Number.parseInt(rateLimitResetHeader, 10);
    if (!Number.isNaN(resetTimestamp)) {
      resetAt = resetTimestamp;
      const now = Math.floor(Date.now() / 1000);
      const delaySeconds = Math.max(0, resetTimestamp - now);
      delayFromReset = delaySeconds * 1000;
    }
  }

  // Parse retry-after header (seconds)
  const retryAfterHeader = response.headers.get('retry-after');
  let retryAfter: number | undefined;
  let delayFromRetryAfter: number | undefined;

  if (retryAfterHeader) {
    const retryAfterSeconds = Number.parseInt(retryAfterHeader, 10);
    if (!Number.isNaN(retryAfterSeconds)) {
      retryAfter = retryAfterSeconds;
      delayFromRetryAfter = retryAfterSeconds * 1000;
    }
  }

  // Calculate exponential backoff with jitter
  const baseDelay = Math.min(1000 * 2 ** retryCount, MAX_RETRY_DELAY_MS);
  const jitter = Math.random() * 0.3 * baseDelay; // 0-30% jitter
  const exponentialBackoffDelay = baseDelay + jitter;

  // Use the maximum of header values and exponential backoff, capped at MAX_RETRY_DELAY_MS
  const delays = [delayFromReset, delayFromRetryAfter, exponentialBackoffDelay].filter(
    (d): d is number => d !== undefined,
  );

  const delayMs = Math.min(
    delays.length > 0 ? Math.max(...delays) : DEFAULT_RETRY_DELAY_MS,
    MAX_RETRY_DELAY_MS,
  );

  logger.info(
    {
      retryCount,
      delayMs,
      resetAt,
      retryAfter,
      exponentialBackoffDelay,
      rateLimitResetHeader,
      retryAfterHeader,
    },
    'Calculated retry delay for rate limit',
  );

  const result: RateLimitInfo = {
    delayMs,
  };

  if (retryAfter !== undefined) {
    result.retryAfter = retryAfter;
  }

  if (resetAt !== undefined) {
    result.resetAt = resetAt;
  }

  return result;
}
