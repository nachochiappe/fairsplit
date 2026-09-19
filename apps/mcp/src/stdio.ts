import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { FairsplitApiClient } from './api-client.js';
import { readMcpConfig } from './config.js';
import { createFairsplitMcpServer } from './server.js';

try {
  const config = readMcpConfig();
  const handle = serveStdio(
    () => createFairsplitMcpServer(new FairsplitApiClient(config.apiBaseUrl, config.token)),
    { onerror: (error) => console.error(error) },
  );

  const shutdown = () => {
    void handle.close();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
