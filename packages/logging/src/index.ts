import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';

export type { Logger } from 'pino';
export type { DestinationStream } from 'pino';

export const REQUEST_ID_HEADER = 'x-request-id';

const DEFAULT_LEVEL = 'info';
const REDACTED = '[Redacted]';

const redactionPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers.set-cookie',
  'req.headers.x-fairsplit-session',
  'req.headers.x-fairsplit-csrf',
  'req.body.accessToken',
  'req.body.sessionToken',
  'req.body.authorization',
  'req.body.cookie',
  'req.body.set-cookie',
  'req.body.x-fairsplit-session',
  'req.body.x-fairsplit-csrf',
  'res.headers.set-cookie',
  'authorization',
  'cookie',
  'set-cookie',
  'accessToken',
  'sessionToken',
  'x-fairsplit-session',
  'x-fairsplit-csrf',
  '*.authorization',
  '*.cookie',
  '*.set-cookie',
  '*.accessToken',
  '*.sessionToken',
  '*.x-fairsplit-session',
  '*.x-fairsplit-csrf',
];

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  return fallback;
}

function shouldPrettyPrint(): boolean {
  return parseBoolean(process.env.LOG_PRETTY, process.env.NODE_ENV !== 'production');
}

function createTransport(): LoggerOptions['transport'] | undefined {
  if (!shouldPrettyPrint()) {
    return undefined;
  }

  return {
    target: 'pino-pretty',
    options: {
      colorize: true,
      ignore: 'pid,hostname',
      singleLine: false,
      translateTime: 'SYS:standard',
    },
  };
}

export interface CreateLoggerOptions {
  destination?: DestinationStream;
  service: string;
}

export function createLogger({ destination, service }: CreateLoggerOptions): Logger {
  const env = process.env.NODE_ENV ?? 'development';
  const version = process.env.APP_VERSION?.trim();
  const transport = createTransport();

  return pino({
    level: process.env.LOG_LEVEL?.trim() || DEFAULT_LEVEL,
    base: {
      service,
      env,
      ...(version ? { version } : {}),
    },
    redact: {
      paths: redactionPaths,
      censor: REDACTED,
      remove: false,
    },
    ...(transport ? { transport } : {}),
  }, destination);
}
