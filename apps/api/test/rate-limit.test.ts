import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createRateLimit, hashedRateLimitKey, requestIpKey } from '../src/lib/rate-limit';

describe('createRateLimit', () => {
  it('rejects requests over the limit and resets deterministically after the window', async () => {
    let now = 1_000;
    const app = express();
    app.get(
      '/limited',
      createRateLimit({ limit: 2, windowMs: 10_000, key: requestIpKey, now: () => now }),
      (_request, response) => response.json({ ok: true }),
    );

    const first = await request(app).get('/limited');
    expect(first.status).toBe(200);
    expect(first.headers['ratelimit-limit']).toBe('2');
    expect(first.headers['ratelimit-remaining']).toBe('1');

    const second = await request(app).get('/limited');
    expect(second.status).toBe(200);
    expect(second.headers['ratelimit-remaining']).toBe('0');

    const rejected = await request(app).get('/limited');
    expect(rejected.status).toBe(429);
    expect(rejected.headers['retry-after']).toBe('10');
    expect(rejected.body).toEqual({ error: 'Too many requests. Please try again later.' });

    now += 10_000;
    const afterReset = await request(app).get('/limited');
    expect(afterReset.status).toBe(200);
    expect(afterReset.headers['ratelimit-remaining']).toBe('1');
  });

  it('hashes sensitive identifiers before using them as store keys', () => {
    const key = hashedRateLimitKey('session', 'secret-session-token', 'fallback');

    expect(key).toMatch(/^session:/);
    expect(key).not.toContain('secret-session-token');
    expect(hashedRateLimitKey('session', undefined, 'fallback')).toBe('fallback');
  });
});
