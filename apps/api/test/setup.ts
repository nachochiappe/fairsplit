import 'dotenv/config';
import { TEST_SESSION_SECRET } from '@fairsplit/shared';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const appDatabaseUrl = process.env.DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL is required for API tests. Refusing to run tests against the default DATABASE_URL.',
  );
}

if (appDatabaseUrl && appDatabaseUrl === testDatabaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL must be different from DATABASE_URL. Refusing to run tests against the primary database.',
  );
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl;
process.env.FAIRSPLIT_SESSION_SECRET = TEST_SESSION_SECRET;
process.env.SUPABASE_JWT_SECRET = 'fairsplit-test-supabase-jwt-secret';
process.env.SUPABASE_JWT_AUDIENCE = 'authenticated';

// Keep authentication tests hermetic even when a developer has real Supabase
// values in apps/api/.env. Invalid test tokens must never fall back to the
// remote user endpoint, and local JWT fixtures must not inherit a live issuer.
delete process.env.SUPABASE_JWT_ISSUER;
delete process.env.SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
delete process.env.SUPABASE_PUBLISHABLE_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
