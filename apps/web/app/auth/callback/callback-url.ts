function parseFragment(hash: string): URLSearchParams {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  return new URLSearchParams(raw);
}

function sanitizedCallbackPath(url: URL): string {
  url.hash = '';
  url.searchParams.delete('access_token');

  return `${url.pathname}${url.search}`;
}

/**
 * Reads an implicit-flow access token from the URL fragment and removes callback
 * credentials from the current history entry before returning it to the caller.
 * Query-string tokens are deliberately ignored.
 */
export function consumeCallbackAccessToken(
  callbackUrl: string,
  replaceUrl: (url: string) => void,
): string | null {
  const url = new URL(callbackUrl);
  const token = parseFragment(url.hash).get('access_token');

  replaceUrl(sanitizedCallbackPath(url));

  return token && token.trim().length > 0 ? token : null;
}
