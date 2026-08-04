import { describe, expect, it } from 'vitest';
import { createContentSecurityPolicy, createSecurityHeaders } from './security-headers';

function toHeaderRecord(headers: ReturnType<typeof createSecurityHeaders>): Record<string, string> {
  return Object.fromEntries(headers.map(({ key, value }) => [key, value]));
}

describe('browser security headers', () => {
  it('creates a restrictive production policy with the configured Supabase origin', () => {
    const headers = toHeaderRecord(
      createSecurityHeaders({
        isDevelopment: false,
        supabaseUrl: 'https://project.supabase.co/auth/v1',
      }),
    );

    expect(headers['Content-Security-Policy']).toContain(
      "connect-src 'self' https://project.supabase.co",
    );
    expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(headers['Content-Security-Policy']).toContain("object-src 'none'");
    expect(headers['Content-Security-Policy']).toContain('upgrade-insecure-requests');
    expect(headers['Content-Security-Policy']).not.toContain("'unsafe-eval'");
    expect(headers['Strict-Transport-Security']).toBe('max-age=31536000');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['Permissions-Policy']).toContain('publickey-credentials-get=(self)');
  });

  it('allows local Fast Refresh only in development and omits HSTS', () => {
    const headers = toHeaderRecord(createSecurityHeaders({ isDevelopment: true }));

    expect(headers['Content-Security-Policy']).toContain(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    );
    expect(headers['Content-Security-Policy']).toContain('ws://localhost:*');
    expect(headers['Content-Security-Policy']).not.toContain('upgrade-insecure-requests');
    expect(headers['Strict-Transport-Security']).toBeUndefined();
  });

  it('does not add malformed or non-HTTP Supabase URLs to connect-src', () => {
    const malformedPolicy = createContentSecurityPolicy({
      isDevelopment: false,
      supabaseUrl: 'not a url',
    });
    const javascriptPolicy = createContentSecurityPolicy({
      isDevelopment: false,
      supabaseUrl: 'javascript:alert(1)',
    });

    expect(malformedPolicy).toContain("connect-src 'self';");
    expect(javascriptPolicy).toContain("connect-src 'self';");
    expect(malformedPolicy).not.toContain('not a url');
    expect(javascriptPolicy).not.toContain('javascript:');
  });
});
