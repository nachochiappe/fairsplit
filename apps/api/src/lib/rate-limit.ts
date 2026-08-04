import { createHash } from 'node:crypto';
import type { Request, RequestHandler } from 'express';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  limit: number;
  windowMs: number;
  key: (request: Request) => string;
  now?: () => number;
  maxEntries?: number;
}

const DEFAULT_MAX_ENTRIES = 10_000;

function evictOldestEntries(entries: Map<string, RateLimitEntry>, maxEntries: number): void {
  while (entries.size > maxEntries) {
    const oldestKey = entries.keys().next().value as string | undefined;
    if (oldestKey === undefined) {
      return;
    }
    entries.delete(oldestKey);
  }
}

/**
 * Process-local fixed-window limiting for low-volume, security-sensitive routes.
 * The bounded store prevents an attacker from growing memory indefinitely.
 */
export function createRateLimit(options: RateLimitOptions): RequestHandler {
  if (!Number.isInteger(options.limit) || options.limit < 1) {
    throw new Error('Rate limit must be a positive integer.');
  }
  if (!Number.isInteger(options.windowMs) || options.windowMs < 1) {
    throw new Error('Rate limit window must be a positive integer.');
  }

  const entries = new Map<string, RateLimitEntry>();
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;

  return (request, response, next) => {
    const timestamp = now();
    const key = options.key(request);
    const existing = entries.get(key);
    const entry =
      !existing || existing.resetAt <= timestamp
        ? { count: 0, resetAt: timestamp + options.windowMs }
        : existing;

    entry.count += 1;
    // Refresh insertion order so bounded eviction favors recently active keys.
    entries.delete(key);
    entries.set(key, entry);
    evictOldestEntries(entries, maxEntries);

    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - timestamp) / 1000));
    response.setHeader('RateLimit-Limit', options.limit.toString());
    response.setHeader('RateLimit-Remaining', Math.max(0, options.limit - entry.count).toString());
    response.setHeader('RateLimit-Reset', retryAfterSeconds.toString());

    if (entry.count > options.limit) {
      response.setHeader('Retry-After', retryAfterSeconds.toString());
      return response.status(429).json({ error: 'Too many requests. Please try again later.' });
    }

    next();
  };
}

export function requestIpKey(request: Request): string {
  return `ip:${request.ip || request.socket.remoteAddress || 'unknown'}`;
}

export function hashedRateLimitKey(
  namespace: string,
  value: string | undefined,
  fallback: string,
): string {
  if (!value) {
    return fallback;
  }
  return `${namespace}:${createHash('sha256').update(value).digest('base64url')}`;
}
