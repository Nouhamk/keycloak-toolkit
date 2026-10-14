import { describe, expect, it } from 'vitest';
import { annotateClaims, decode, verify } from '../../src/tokens/JwtInspector';
import { startLoopback } from '../../src/tokens/PkceLoopbackServer';
import { createPkce, randomState, TokenService } from '../../src/tokens/TokenService';

const BASE = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const backend = { clientId: 'reports-backend', clientSecret: 'dev-only-secret' };
const spa = { clientId: 'reports-spa' };

/** Drives the Keycloak login form like a browser would, without a browser. */
async function browserLogin(authUrl: string, username: string, password: string): Promise<void> {
  const jar = new Map<string, string>();
  const keep = (res: Response) =>
    res.headers.getSetCookie().forEach((c) => {
      const [kv] = c.split(';');
      const i = kv!.indexOf('=');
      jar.set(kv!.slice(0, i), kv!.slice(i + 1));
    });
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

  const page = await fetch(authUrl, { redirect: 'manual' });
  keep(page);
  const html = await page.text();
  const action = html.match(/id="kc-form-login"[^>]*action="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&');
  if (!action) throw new Error('Login form not found');

  const post = await fetch(action, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookie() },
    body: new URLSearchParams({ username, password, credentialId: '' }),
  });
  const location = post.headers.get('location');
  if (post.status !== 302 || !location) throw new Error(`Login did not redirect (${post.status})`);
  await fetch(location); // hits the loopback server
}

describe('token flows against the demo realm', () => {
  const s = new TokenService(BASE, 'demo');

  it('client_credentials → token verifies against the realm JWKS', async () => {
    const t = await s.clientCredentials(backend);
    const d = await s.discover();
    expect(await verify(t.access_token, d.jwks_uri, d.issuer)).toEqual({ status: 'valid' });
    expect(decode(t.access_token).payload.azp).toBe('reports-backend');
  });

  it('authorization code + PKCE via loopback; userinfo, introspect, refresh', async () => {
    const state = randomState();
    const pkce = createPkce();
    const loop = await startLoopback(state, 20_000);
    const url = await s.authorizationUrl(spa, {
      redirectUri: loop.redirectUri,
      state,
      codeChallenge: pkce.challenge,
      scope: 'openid profile email',
    });
    await browserLogin(url, 'alice', 'alice');
    const code = await loop.code;
    const t = await s.exchangeCode(spa, code, loop.redirectUri, pkce.verifier);
    expect(t.id_token).toBeTruthy();

    const claims = annotateClaims(decode(t.access_token).payload);
    expect(claims.realmRoles).toContain('reports-viewer'); // via group "analysts"
    expect(claims.authorizedParty).toBe('reports-spa');

    expect((await s.userinfo(t.access_token)).preferred_username).toBe('alice');
    expect((await s.introspect(backend, t.access_token)).active).toBe(true);

    const r = await s.refresh(spa, t.refresh_token!);
    expect(r.access_token).not.toBe(t.access_token);
  });

  it('device authorization returns a user code', async () => {
    const d = await s.startDeviceAuthorization(spa, 'openid');
    expect(d.user_code).toBeTruthy();
    expect(d.verification_uri).toContain('/realms/demo/device');
  });

  it('rejects a wrong client secret with a hint', async () => {
    await expect(s.clientCredentials({ ...backend, clientSecret: 'wrong' })).rejects.toThrow(
      /Check the client ID and secret/,
    );
  });
});
