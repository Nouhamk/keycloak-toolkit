import { describe, expect, it, vi } from 'vitest';
import { KeycloakAdminApi, describeNetworkError } from '../../src/connections/KeycloakAdminApi';
import type { Connection } from '../../src/connections/types';

const conn: Connection = {
  id: 'c1',
  name: 'Local',
  baseUrl: 'http://kc',
  authRealm: 'master',
  authMethod: 'password',
  principal: 'admin',
  environment: 'local',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(handler: (url: string, init: RequestInit) => Response) {
  let now = 0;
  const calls: { url: string; body?: string }[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body?.toString() });
    return handler(String(url), init ?? {});
  }) as unknown as typeof fetch;
  const api = new KeycloakAdminApi(conn, 's3cr3t', { fetch: fetchFn, now: () => now });
  return { api, calls, tick: (ms: number) => (now += ms) };
}

describe('KeycloakAdminApi', () => {
  it('logs in once via admin-cli and caches the token', async () => {
    const { api, calls } = setup((url) =>
      url.endsWith('/token')
        ? json({ access_token: 'AT', refresh_token: 'RT', expires_in: 60 })
        : json([{ realm: 'master' }, { realm: 'demo' }]),
    );
    expect((await api.listRealms()).map((r) => r.realm)).toEqual(['master', 'demo']);
    await api.listRealms();
    const tokenCalls = calls.filter((c) => c.url.endsWith('/token'));
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]!.url).toBe('http://kc/realms/master/protocol/openid-connect/token');
    expect(tokenCalls[0]!.body).toContain('client_id=admin-cli');
    expect(tokenCalls[0]!.body).toContain('grant_type=password');
  });

  it('uses the refresh token when the access token expires', async () => {
    const { api, calls, tick } = setup((url) =>
      url.endsWith('/token')
        ? json({ access_token: 'AT', refresh_token: 'RT', expires_in: 60 })
        : json([]),
    );
    await api.listRealms();
    tick(61_000);
    await api.listRealms();
    const grants = calls
      .filter((c) => c.url.endsWith('/token'))
      .map((c) => new URLSearchParams(c.body).get('grant_type'));
    expect(grants).toEqual(['password', 'refresh_token']);
  });

  it('gives an actionable, redacted error on bad credentials', async () => {
    const { api } = setup(() =>
      json({ error: 'invalid_grant', error_description: 'Invalid user credentials' }, 401),
    );
    await expect(api.listRealms()).rejects.toThrow(/HTTP 401.*Check the username/);
  });

  it('builds search queries for clients', async () => {
    const { api, calls } = setup((url) =>
      url.endsWith('/token') ? json({ access_token: 'AT', expires_in: 60 }) : json([]),
    );
    await api.listClients('demo', 'reports', 50);
    const u = new URL(calls.at(-1)!.url);
    expect(u.pathname).toBe('/admin/realms/demo/clients');
    expect(u.searchParams.get('clientId')).toBe('reports');
    expect(u.searchParams.get('search')).toBe('true');
    expect(u.searchParams.get('max')).toBe('50');
  });
});

describe('describeNetworkError', () => {
  it('explains common failures', () => {
    expect(describeNetworkError({ cause: { code: 'ECONNREFUSED' } }, 'http://kc')).toMatch(
      /Is Keycloak running/,
    );
    expect(describeNetworkError({ name: 'TimeoutError' }, 'http://kc')).toMatch(/Timed out/);
    expect(
      describeNetworkError({ cause: { code: 'SELF_SIGNED_CERT_IN_CHAIN' } }, 'https://kc'),
    ).toMatch(/TLS/);
  });
});
