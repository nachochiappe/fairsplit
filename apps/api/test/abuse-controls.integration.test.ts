import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';

describe('API abuse controls', () => {
  it('does not enable cross-origin browser access', async () => {
    const response = await request(createApp())
      .get('/api/health')
      .set('Origin', 'https://attacker.example');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rate limits repeated attempts to redeem the same auth token', async () => {
    const app = createApp();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request(app)
        .post('/api/auth/link')
        .send({ accessToken: 'replayed-invalid-token' });
      expect(response.status).toBe(401);
    }

    const rejected = await request(app)
      .post('/api/auth/link')
      .send({ accessToken: 'replayed-invalid-token' });

    expect(rejected.status).toBe(429);
    expect(rejected.headers['retry-after']).toBeDefined();
    expect(rejected.body).toEqual({ error: 'Too many requests. Please try again later.' });
  });
});
