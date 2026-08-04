import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertSafeDatabaseUrl, isLocalDatabaseUrl } from '../src/database-url';

describe('isLocalDatabaseUrl', () => {
  it('accepts loopback PostgreSQL URLs', () => {
    const localUrls = [
      'postgresql://postgres:postgres@localhost:5433/fairsplit',
      'postgres://postgres:postgres@127.0.0.1:5433/fairsplit',
      'postgresql://postgres:postgres@127.15.20.25:5433/fairsplit',
      'postgresql://postgres:postgres@[::1]:5433/fairsplit',
    ];

    for (const databaseUrl of localUrls) {
      assert.equal(isLocalDatabaseUrl(databaseUrl), true, databaseUrl);
    }
  });

  it('accepts an explicit local Unix socket', () => {
    assert.equal(
      isLocalDatabaseUrl('postgresql:///fairsplit?host=%2Fvar%2Frun%2Fpostgresql'),
      true,
    );
  });

  it('rejects remote, malformed, and non-PostgreSQL URLs', () => {
    const unsafeUrls = [
      'postgresql://postgres:postgres@db.example.com:5432/fairsplit',
      'postgresql://postgres:postgres@192.168.1.20:5432/fairsplit',
      'postgresql://postgres:postgres@127.example.com:5432/fairsplit',
      'mysql://root@localhost/fairsplit',
      'not-a-url',
    ];

    for (const databaseUrl of unsafeUrls) {
      assert.equal(isLocalDatabaseUrl(databaseUrl), false, databaseUrl);
    }
  });

  it('rejects query parameters that can override the authority host', () => {
    const unsafeUrls = [
      'postgresql://postgres:postgres@localhost/fairsplit?host=db.example.com',
      'postgresql://postgres:postgres@localhost/fairsplit?hostaddr=203.0.113.10',
      'postgresql:///fairsplit?host=db.example.com',
      'postgresql:///fairsplit?host=%2Ftmp&host=db.example.com',
      'postgresql:///fairsplit?host=%2Ftmp&service=remote',
    ];

    for (const databaseUrl of unsafeUrls) {
      assert.equal(isLocalDatabaseUrl(databaseUrl), false, databaseUrl);
    }
  });
});

describe('assertSafeDatabaseUrl', () => {
  it('allows a local database outside production', () => {
    assert.doesNotThrow(() =>
      assertSafeDatabaseUrl({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/fairsplit',
      }),
    );
  });

  it('rejects missing, invalid, and remote databases outside production', () => {
    assert.throws(() => assertSafeDatabaseUrl({ NODE_ENV: 'test' }), /DATABASE_URL is required/);
    assert.throws(
      () => assertSafeDatabaseUrl({ NODE_ENV: 'development', DATABASE_URL: 'not-a-url' }),
      /Refusing to initialize Prisma/,
    );
    assert.throws(
      () =>
        assertSafeDatabaseUrl({
          NODE_ENV: 'development',
          DATABASE_URL: 'postgresql://user:secret@db.example.com/fairsplit',
        }),
      /Refusing to initialize Prisma/,
    );
  });

  it('allows a managed database in production', () => {
    assert.doesNotThrow(() =>
      assertSafeDatabaseUrl({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:secret@db.example.com/fairsplit',
      }),
    );
  });
});
