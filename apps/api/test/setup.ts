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
