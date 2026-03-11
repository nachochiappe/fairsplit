import { createApp } from './app';
import { createApiLogger } from './lib/logger';

const logger = createApiLogger();
const app = createApp({ logger });
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);

const server = app.listen(port, () => {
  logger.info({ port }, 'API listening');
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception');
  server.close(() => {
    process.exit(1);
  });
  setTimeout(() => process.exit(1), 1_000).unref();
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  server.close(() => {
    process.exit(1);
  });
  setTimeout(() => process.exit(1), 1_000).unref();
});
