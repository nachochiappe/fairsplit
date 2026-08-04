type SecurityHeadersOptions = {
  isDevelopment: boolean;
  supabaseUrl?: string;
};

export type SecurityHeader = {
  key: string;
  value: string;
};

function getHttpOrigin(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

export function createContentSecurityPolicy({
  isDevelopment,
  supabaseUrl,
}: SecurityHeadersOptions): string {
  const connectSources = ["'self'"];
  const supabaseOrigin = getHttpOrigin(supabaseUrl);

  if (supabaseOrigin) {
    connectSources.push(supabaseOrigin);
  }

  if (isDevelopment) {
    // Next.js uses a WebSocket for Fast Refresh. These sources are deliberately
    // absent from production builds.
    connectSources.push('ws://localhost:*', 'ws://127.0.0.1:*');
  }

  const scriptSources = ["'self'", "'unsafe-inline'"];
  if (isDevelopment) {
    // Source maps and React development tooling require eval in `next dev`.
    scriptSources.push("'unsafe-eval'");
  }

  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    `connect-src ${connectSources.join(' ')}`,
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "img-src 'self' data: blob:",
    "manifest-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    `script-src ${scriptSources.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
  ];

  if (!isDevelopment) {
    directives.push('upgrade-insecure-requests');
  }

  return directives.join('; ');
}

export function createSecurityHeaders(options: SecurityHeadersOptions): SecurityHeader[] {
  const headers: SecurityHeader[] = [
    {
      key: 'Content-Security-Policy',
      value: createContentSecurityPolicy(options),
    },
    {
      key: 'Permissions-Policy',
      value: [
        'camera=()',
        'display-capture=()',
        'geolocation=()',
        'microphone=()',
        'payment=()',
        'publickey-credentials-create=(self)',
        'publickey-credentials-get=(self)',
        'usb=()',
      ].join(', '),
    },
    {
      key: 'Referrer-Policy',
      value: 'strict-origin-when-cross-origin',
    },
    {
      key: 'X-Content-Type-Options',
      value: 'nosniff',
    },
    {
      key: 'X-Frame-Options',
      value: 'DENY',
    },
    {
      key: 'X-Permitted-Cross-Domain-Policies',
      value: 'none',
    },
  ];

  if (!options.isDevelopment) {
    // Browsers ignore this header over plain HTTP, so local `next start`
    // remains usable while HTTPS deployments receive transport protection.
    headers.push({
      key: 'Strict-Transport-Security',
      value: 'max-age=31536000',
    });
  }

  return headers;
}
