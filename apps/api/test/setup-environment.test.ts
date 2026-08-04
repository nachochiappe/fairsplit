import { describe, expect, it } from 'vitest';

describe('API test environment', () => {
  it('uses hermetic Supabase fixtures instead of developer credentials', () => {
    expect(process.env.SUPABASE_JWT_SECRET).toBe('fairsplit-test-supabase-jwt-secret');
    expect(process.env.SUPABASE_JWT_AUDIENCE).toBe('authenticated');
    expect(process.env.SUPABASE_JWT_ISSUER).toBeUndefined();
    expect(process.env.SUPABASE_URL).toBeUndefined();
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBeUndefined();
    expect(process.env.SUPABASE_ANON_KEY).toBeUndefined();
  });
});
