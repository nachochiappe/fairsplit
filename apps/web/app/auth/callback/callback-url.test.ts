import { describe, expect, it, vi } from 'vitest';
import { consumeCallbackAccessToken } from './callback-url';

describe('consumeCallbackAccessToken', () => {
  it('accepts a fragment token and clears callback credentials synchronously', () => {
    const replaceUrl = vi.fn();

    const token = consumeCallbackAccessToken(
      'https://fairsplit.example/auth/callback?invite=abc#access_token=header.payload.signature&expires_in=3600',
      replaceUrl,
    );

    expect(replaceUrl).toHaveBeenCalledOnce();
    expect(replaceUrl).toHaveBeenCalledWith('/auth/callback?invite=abc');
    expect(token).toBe('header.payload.signature');
  });

  it('rejects a query-string token and removes it from the address bar', () => {
    const replaceUrl = vi.fn();

    const token = consumeCallbackAccessToken(
      'https://fairsplit.example/auth/callback?access_token=query-token&invite=abc',
      replaceUrl,
    );

    expect(token).toBeNull();
    expect(replaceUrl).toHaveBeenCalledWith('/auth/callback?invite=abc');
  });

  it('clears the URL before exposing the token to subsequent work', () => {
    let cleared = false;

    const token = consumeCallbackAccessToken(
      'https://fairsplit.example/auth/callback#access_token=fragment-token',
      () => {
        cleared = true;
      },
    );

    expect(cleared).toBe(true);
    expect(token).toBe('fragment-token');
  });
});
