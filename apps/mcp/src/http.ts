import { createServer, type IncomingMessage } from 'node:http';
import { hostHeaderValidation, originValidation, toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, type AuthInfo } from '@modelcontextprotocol/server';
import { FairsplitApiClient } from './api-client.js';
import { readMcpConfig } from './config.js';
import { createFairsplitMcpServer } from './server.js';

const host = process.env.MCP_HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? process.env.MCP_PORT ?? 4101);
const configuredHostnames = process.env.MCP_ALLOWED_HOSTS?.split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
if (!loopback && (!configuredHostnames || configuredHostnames.length === 0)) {
  throw new Error('MCP_ALLOWED_HOSTS is required when MCP_HOST is not loopback.');
}
const allowedHostnames = configuredHostnames ?? ['localhost', '127.0.0.1', '[::1]'];
const validateHost = hostHeaderValidation(allowedHostnames);
const validateOrigin = originValidation(allowedHostnames);

const handler = createMcpHandler(({ authInfo }) => {
  if (!authInfo?.token) {
    throw new Error('Missing Fairsplit integration token.');
  }
  const config = readMcpConfig(authInfo.token);
  return createFairsplitMcpServer(new FairsplitApiClient(config.apiBaseUrl, config.token));
});
const nodeHandler = toNodeHandler(handler, { onerror: (error) => console.error(error) });

function bearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization?.trim();
  const match = header ? /^Bearer\s+(fsp_[A-Za-z0-9_-]{43})$/i.exec(header) : null;
  return match?.[1] ?? null;
}

const httpServer = createServer(async (request, response) => {
  if (!validateHost(request, response) || !validateOrigin(request, response)) {
    return;
  }

  const requestPath = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (request.method === 'GET' && requestPath === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  if (requestPath !== '/mcp') {
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Not found' }));
    return;
  }
  const token = bearerToken(request);
  if (!token) {
    response.writeHead(401, {
      'Content-Type': 'application/json',
      'WWW-Authenticate': 'Bearer realm="Fairsplit MCP"',
    });
    response.end(JSON.stringify({ error: 'A Fairsplit integration token is required.' }));
    return;
  }

  const auth: AuthInfo = {
    token,
    clientId: 'fairsplit-integration',
    scopes: ['transactions:read', 'transactions:write'],
  };
  (request as IncomingMessage & { auth: AuthInfo }).auth = auth;
  await nodeHandler(request as IncomingMessage & { auth: AuthInfo }, response);
});

httpServer.listen(port, host, () => {
  console.error(`Fairsplit MCP listening at http://${host}:${port}/mcp`);
});

const shutdown = () => {
  httpServer.close(() => {
    void handler.close();
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
