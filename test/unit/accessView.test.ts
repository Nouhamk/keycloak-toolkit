import { describe, expect, it } from 'vitest';
import { parseAccessMessage, renderAccess, type AccessModel } from '../../src/access/view';

const model = (over: Partial<AccessModel> = {}): AccessModel => ({
  realm: 'demo',
  connection: 'Local',
  environment: 'prod',
  explanation: {
    user: '<img src=x onerror=alert(1)>',
    target: { name: 'reports-viewer' },
    has: true,
    paths: [
      [
        { kind: 'user', name: 'alice' },
        { kind: 'group', path: '/analysts', via: 'member' },
        { kind: 'role', name: 'reports-viewer', via: 'group' },
      ],
    ],
    effective: [{ name: 'reports-viewer' }],
  },
  token: {
    client: 'billing-app',
    contains: false,
    fullScopeAllowed: false,
    payload: { note: '</pre><script>bad()</script>' },
  },
  ...over,
});

describe('explain access view', () => {
  it('escapes untrusted data and keeps a strict CSP', () => {
    const html = renderAccess(model(), 'N', 'vscode-resource:');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>bad()');
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/\sstyle="/); // inline styles would be blocked by the CSP
  });

  it('shows the warning state when the token filters the role', () => {
    const html = renderAccess(model(), 'N', 'x');
    expect(html).toContain('verdict warn');
    expect(html).toContain('Full scope allowed');
  });

  it('shows the granting groups when the role is missing', () => {
    const html = renderAccess(
      model({
        explanation: { ...model().explanation, has: false, paths: [] },
        token: undefined,
        grantingGroups: ['/admins'],
      }),
      'N',
      'x',
    );
    expect(html).toContain('verdict bad');
    expect(html).toContain('/admins');
  });

  it('accepts only allowlisted messages', () => {
    expect(parseAccessMessage({ action: 'rerun' })).toBe('rerun');
    expect(parseAccessMessage({ action: 'delete-user' })).toBeUndefined();
  });
});
