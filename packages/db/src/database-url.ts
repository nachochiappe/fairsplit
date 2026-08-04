const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);

interface DatabaseEnvironment {
  DATABASE_URL?: string;
  NODE_ENV?: string;
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);

  if (normalized === 'localhost' || normalized === '::1') {
    return true;
  }

  const ipv4Octets = normalized.split('.');
  return (
    ipv4Octets.length === 4 &&
    ipv4Octets[0] === '127' &&
    ipv4Octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  );
}

/**
 * Returns true only for PostgreSQL URLs that cannot leave the local machine.
 *
 * Query-string host overrides are rejected because they can silently replace a
 * loopback hostname. A URL without an authority may use an absolute Unix socket
 * path, which is local by definition.
 */
export function isLocalDatabaseUrl(databaseUrl: string): boolean {
  let parsed: URL;

  try {
    parsed = new URL(databaseUrl);
  } catch {
    return false;
  }

  if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) {
    return false;
  }

  const queryHosts = parsed.searchParams.getAll('host');
  const queryHostAddresses = parsed.searchParams.getAll('hostaddr');

  if (queryHostAddresses.length > 0 || parsed.searchParams.has('service')) {
    return false;
  }

  if (parsed.hostname === '') {
    return queryHosts.length === 1 && queryHosts[0]?.startsWith('/') === true;
  }

  if (queryHosts.length > 0) {
    return false;
  }

  return isLoopbackHostname(parsed.hostname);
}

export function assertSafeDatabaseUrl(environment?: DatabaseEnvironment): void {
  const nodeEnvironment = environment === undefined ? process.env.NODE_ENV : environment.NODE_ENV;
  const databaseUrl =
    environment === undefined ? process.env.DATABASE_URL : environment.DATABASE_URL;

  if (nodeEnvironment === 'production') {
    return;
  }

  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is required outside production and must point to a loopback PostgreSQL server or local Unix socket.',
    );
  }

  if (!isLocalDatabaseUrl(databaseUrl)) {
    throw new Error(
      'Refusing to initialize Prisma outside production with a remote or invalid DATABASE_URL. Use localhost, a 127.0.0.0/8 address, ::1, or a local Unix socket.',
    );
  }
}
