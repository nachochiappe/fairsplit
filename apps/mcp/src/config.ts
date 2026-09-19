export interface McpConfig {
  apiBaseUrl: string;
  token: string;
}

export function readMcpConfig(tokenOverride?: string): McpConfig {
  const token = tokenOverride ?? process.env.FAIRSPLIT_API_TOKEN?.trim();
  if (!token) {
    throw new Error(
      'FAIRSPLIT_API_TOKEN is required. Create one in Fairsplit Settings > Security.',
    );
  }
  if (!/^fsp_[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error('FAIRSPLIT_API_TOKEN is not a valid Fairsplit integration token.');
  }
  return {
    apiBaseUrl: (process.env.FAIRSPLIT_API_URL ?? 'http://localhost:4000/api').replace(/\/+$/, ''),
    token,
  };
}
