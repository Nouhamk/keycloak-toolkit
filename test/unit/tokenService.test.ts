import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createPkce, TokenService, toCurl, DEVICE_GRANT } from '../../src/tokens/TokenService';

const BASE = 'http://kc';
const DISCOVERY = {
  issuer: `${BASE}/realms/demo`,
  authorization_endpoint: `${BASE}/realms/demo/protocol/openid-connect/auth`,
  token_endpoint: `${BASE}/realms/demo/protocol/openid-connect/token`,
  userinfo_endpoint: `${BASE}/realms/demo/protocol/openid-connect/userinfo`,
  introspection_endpoint: `${BASE}/realms/demo/protocol/openid-connect/token/introspect`,
  jwks_uri: `${BASE}/realms/demo/protocol/openid-connect/certs`,
  device_authorization_endpoint: `${BASE}/realms/demo/protocol/openid-connect/auth/device`,
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

function svc(handler: (url: string, body: URLSearchParams) => Response) {
  const calls: { url: string; body: URLSearchParams }[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const body = new URLSearchParams(init?.body?.toString() ?? '');
    calls.push({ url: u, body });
    if (u.endsWith('openid-configuration')) return json(DISCOVERY);
    return handler(u, body);
  }) as unknown as typeof fetch;
  return { s: new TokenService(BASE, 'demo', { fetch: f }), calls };
}

describe('TokenService', () => {
  it('sends client credentials with id and secret', async () => {
    const { s, calls } = svc(() =>
      json({ access_token: 'a', token_type: 'Bearer', expires_in: 60 }),
    );
    await s.clientCredentials({ clientId: 'c', clientSecret: 'x' });
    const b = calls.at(-1)!.body;
    expect(calls.at(-1)!.url).toBe(DISCOVERY.token_endpoint);
    expect(b.get('grant_type')).toBe('client_credentials');
    expect(b.get('client_id')).toBe('c');
    expect(b.get('client_secret')).toBe('x');
  });

  it('omits client_secret for public clients', async () => {
    const { s, calls } = svc(() =>
      json({ access_token: 'a', token_type: 'Bearer', expires_in: 60 }),
    );
    await s.refresh({ clientId: 'spa' }, 'rt');
    expect(calls.at(-1)!.body.has('client_secret')).toBe(false);
  });

  it('builds a PKCE authorization URL', async () => {
    const { s } = svc(() => json({}));
    const url = new URL(
      await s.authorizationUrl(
        { clientId: 'spa' },
        {
          redirectUri: 'http://127.0.0.1:1/callback',
          state: 'st',
          codeChallenge: 'cc',
          scope: 'openid',
        },
      ),
    );
    expect(url.origin + url.pathname).toBe(DISCOVERY.authorization_endpoint);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: 'spa',
      state: 'st',
      code_challenge: 'cc',
      code_challenge_method: 'S256',
    });
  });

  it('adds an actionable hint to OAuth errors and redacts', async () => {
    const { s } = svc(() =>
      json({ error: 'unauthorized_client', error_description: 'Client not enabled' }, 400),
    );
    await expect(s.clientCredentials({ clientId: 'c', clientSecret: 'x' })).rejects.toThrow(
      /Client not enabled.*Enable it in the client settings/,
    );
  });

  it('polls the device endpoint, honouring pending and slow_down', async () => {
    const replies = [
      json({ error: 'authorization_pending' }, 400),
      json({ error: 'slow_down' }, 400),
      json({ access_token: 'a', token_type: 'Bearer', expires_in: 60 }),
    ];
    const { s, calls } = svc(() => replies.shift()!);
    const sleeps: number[] = [];
    const t = await s.pollDeviceToken(
      { clientId: 'spa' },
      { device_code: 'dc', user_code: 'U', verification_uri: 'v', expires_in: 600, interval: 1 },
      { sleep: async (ms) => void sleeps.push(ms) },
    );
    expect(t.access_token).toBe('a');
    expect(sleeps).toEqual([1000, 1000, 6000]);
    expect(calls.at(-1)!.body.get('grant_type')).toBe(DEVICE_GRANT);
  });

  it('stops device polling on access_denied', async () => {
    const { s } = svc(() => json({ error: 'access_denied' }, 400));
    await expect(
      s.pollDeviceToken(
        { clientId: 'spa' },
        { device_code: 'dc', user_code: 'U', verification_uri: 'v', expires_in: 600 },
        { sleep: async () => undefined },
      ),
    ).rejects.toThrow(/access_denied/);
  });
});

describe('PKCE and helpers', () => {
  it('challenge is base64url(sha256(verifier))', () => {
    const { verifier, challenge } = createPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });
  it('builds curl', () => {
    expect(toCurl('T', 'https://x/y')).toBe(`curl -H 'Authorization: Bearer T' 'https://x/y'`);
  });
});
