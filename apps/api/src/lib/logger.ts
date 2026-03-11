import { randomUUID } from 'node:crypto';
import pinoHttp from 'pino-http';
import { REQUEST_ID_HEADER, createLogger, type Logger } from '@fairsplit/logging';

export function createApiLogger(): Logger {
  return createLogger({ service: 'api' });
}

function shouldIgnoreRequest(url: string | undefined): boolean {
  return url === '/api/health';
}

export function createApiHttpLogger(logger: Logger) {
  return pinoHttp({
    logger,
    genReqId(req, res) {
      const existing = req.headers[REQUEST_ID_HEADER]?.toString().trim();
      const requestId = existing || randomUUID();
      res.setHeader(REQUEST_ID_HEADER, requestId);
      return requestId;
    },
    autoLogging: {
      ignore: (req) => shouldIgnoreRequest(req.url),
    },
    customProps(req) {
      return {
        requestId: req.id,
      };
    },
    customLogLevel(req, res, err) {
      if ((res as { locals?: { disableAutoRequestLog?: boolean } }).locals?.disableAutoRequestLog) {
        return 'silent';
      }
      if (err || res.statusCode >= 500) {
        return 'error';
      }
      return 'info';
    },
    customSuccessMessage(req, res) {
      return `${req.method} ${req.url} completed with ${res.statusCode}`;
    },
    customErrorMessage(req, res, err) {
      return err instanceof Error
        ? `${req.method} ${req.url} failed with ${res.statusCode}: ${err.message}`
        : `${req.method} ${req.url} failed with ${res.statusCode}`;
    },
  });
}
