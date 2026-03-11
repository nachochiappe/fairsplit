import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '@fairsplit/logging';
import { createApp } from '../src/app';

const originalLogPretty = process.env.LOG_PRETTY;
process.env.LOG_PRETTY = 'false';

describe('API logging', () => {
  let logBuffer = '';
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    logBuffer = '';
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: Buffer | string) => {
      logBuffer += chunk.toString();
      return true;
    }) as typeof process.stdout.write);

    app = createApp({
      logger: createLogger({ service: 'api-test' }),
      configureApp(expressApp) {
        expressApp.get('/api/test/logging-ok', (_req, res) => {
          res.status(204).send();
        });
        expressApp.get('/api/test/unexpected-error', () => {
          throw new Error('boom');
        });
      },
    });
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
  });

  afterAll(() => {
    if (originalLogPretty === undefined) {
      delete process.env.LOG_PRETTY;
      return;
    }
    process.env.LOG_PRETTY = originalLogPretty;
  });

  it('generates and preserves request ids on responses', async () => {
    const generated = await request(app).get('/api/test/logging-ok');

    expect(generated.status).toBe(204);
    expect(generated.headers['x-request-id']).toMatch(/[a-f0-9-]{8,}/i);

    const preservedId = 'req-preserved-123';
    const preserved = await request(app)
      .get('/api/test/logging-ok')
      .set('x-request-id', preservedId);

    expect(preserved.status).toBe(204);
    expect(preserved.headers['x-request-id']).toBe(preservedId);
  });

  it('redacts sensitive request values from structured logs', async () => {
    const response = await request(app)
      .get('/api/test/logging-ok')
      .set('x-fairsplit-session', 'session-secret-value')
      .set('authorization', 'Bearer auth-secret')
      .set('cookie', 'fairsplit_session=cookie-secret');

    expect(response.status).toBe(204);

    const lines = await readLogLines(() => logBuffer);
    const serialized = lines.join('\n');
    expect(serialized).not.toContain('session-secret-value');
    expect(serialized).not.toContain('auth-secret');
    expect(serialized).not.toContain('cookie-secret');
    expect(serialized).toContain('[Redacted]');
  });

  it('does not emit error logs for ordinary 400 validation failures', async () => {
    const response = await request(app).post('/api/auth/link').send({});

    expect(response.status).toBe(400);

    const levels = await readLogLevels(() => logBuffer);
    expect(levels).not.toContain(50);
    expect(levels).not.toContain(60);
  });

  it('logs unexpected exceptions exactly once with request id and 500 status', async () => {
    const response = await request(app)
      .get('/api/test/unexpected-error')
      .set('x-request-id', 'req-unexpected-500');

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('Internal server error.');

    const entries = await readLogEntries(() => logBuffer);
    const errorEntries = entries.filter((entry) => entry.level === 50);

    expect(errorEntries).toHaveLength(1);
    expect(errorEntries[0]?.requestId).toBe('req-unexpected-500');
    expect(errorEntries[0]?.statusCode).toBe(500);
    expect(errorEntries[0]?.msg).toBe('Unhandled API request failure');
    expect(errorEntries[0]?.err?.message).toBe('boom');
  });
});

async function readLogEntries(getBuffer: () => string): Promise<Array<Record<string, any>>> {
  await waitForLogs();
  return getBuffer()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, any>);
}

async function readLogLevels(getBuffer: () => string): Promise<number[]> {
  const entries = await readLogEntries(getBuffer);
  return entries.map((entry) => entry.level).filter((level): level is number => typeof level === 'number');
}

async function readLogLines(getBuffer: () => string): Promise<string[]> {
  await waitForLogs();
  return getBuffer()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

async function waitForLogs(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}
