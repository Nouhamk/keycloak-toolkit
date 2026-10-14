import { describe, expect, it } from 'vitest';
import { annotateClaims } from '../../src/tokens/JwtInspector';
import { parseMessage, renderPlayground, type PlaygroundModel } from '../../src/playground/view';

describe('annotateClaims', () => {
  const a = annotateClaims({
    iss: 'http://kc/realms/demo',
    aud: ['reports-backend', 'account'],
    azp: 'reports-spa',
    exp: 0,
    scope: 'openid email',
    realm_access: { roles: ['reports-viewer'] },
    resource_access: { account: { roles: ['view-profile'] } },
    groups: ['/analysts'],
    tenant: 'acme',
  });

  it('extracts roles, scopes, audience and groups', () => {
    expect(a.realmRoles).toEqual(['reports-viewer']);
    expect(a.clientRoles).toEqual({ account: ['view-profile'] });
    expect(a.scopes).toEqual(['openid', 'email']);
    expect(a.audience).toEqual(['reports-backend', 'account']);
    expect(a.groups).toEqual(['/analysts']);
    expect(a.authorizedParty).toBe('reports-spa');
  });

  it('explains standard claims and separates custom ones', () => {
    expect(a.standard.find((n) => n.claim === 'azp')?.explanation).toMatch(/Authorized party/);
    expect(a.standard.find((n) => n.claim === 'exp')?.value).toMatch(/1970-01-01/);
    expect(a.custom.map((n) => n.claim)).toEqual(['tenant']);
  });
});

describe('playground view', () => {
  it('accepts only allowlisted messages', () => {
    expect(parseMessage({ action: 'refresh' })).toBe('refresh');
    expect(parseMessage({ action: 'rm -rf' })).toBeUndefined();
    expect(parseMessage('refresh')).toBeUndefined();
    expect(parseMessage(null)).toBeUndefined();
  });

  it('escapes untrusted content and sets a strict CSP', () => {
    const m: PlaygroundModel = {
      title: '<img src=x onerror=alert(1)>',
      tokens: [{ kind: 'access', label: 'Access token', raw: '"><script>bad()</script>' }],
      actions: { refresh: false, introspect: false, userinfo: false },
      annotations: annotateClaims({ custom: '<b>x</b>' }),
    };
    const html = renderPlayground(m, 'NONCE', 'vscode-resource:');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>bad()');
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'nonce-NONCE'");
    expect(html.match(/<script/g)).toHaveLength(1);
  });
});
