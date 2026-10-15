import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { normalize, normalizeToString } from '../../src/realmAsCode/Normalizer';
import { MASK } from '../../src/util/redact';

describe('Normalizer', () => {
  it('is idempotent (property)', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        const once = normalize(v);
        expect(normalize(once)).toEqual(once);
      }),
      { numRuns: 500 },
    );
  });

  it('ignores the order of named items and of object keys (property)', () => {
    const client = fc.record({
      clientId: fc.string(),
      enabled: fc.boolean(),
      redirectUris: fc.array(fc.webUrl(), { maxLength: 3 }),
    });
    fc.assert(
      fc.property(fc.uniqueArray(client, { selector: (c) => c.clientId }), (clients) => {
        const reversed = clients
          .map((c) => ({
            redirectUris: [...c.redirectUris].reverse(),
            enabled: c.enabled,
            clientId: c.clientId,
          }))
          .reverse();
        expect(normalizeToString({ clients: reversed })).toBe(normalizeToString({ clients }));
      }),
    );
  });

  it('removes server-generated ids', () => {
    expect(
      normalize({
        id: 'r1',
        clients: [{ id: 'c1', clientId: 'app', protocolMappers: [{ id: 'm', name: 'x' }] }],
        roles: { realm: [{ id: 'x', name: 'admin', containerId: 'r1' }] },
      }),
    ).toEqual({
      clients: [{ clientId: 'app', protocolMappers: [{ name: 'x' }] }],
      roles: { realm: [{ name: 'admin' }] },
    });
  });

  it('masks secrets but keeps booleans and policies', () => {
    const out = normalize({
      clients: [{ clientId: 'a', secret: 'real' }],
      smtpServer: { password: 'p', host: 'mail' },
      components: { k: [{ name: 'rsa', config: { privateKey: ['PEM'], priority: ['100'] } }] },
      revokeRefreshToken: true,
      passwordPolicy: 'length(8)',
    }) as Record<string, unknown>;
    const s = JSON.stringify(out);
    expect(s).not.toMatch(/real|"p"|PEM/);
    expect(s).toContain(MASK);
    expect(out.revokeRefreshToken).toBe(true);
    expect(out.passwordPolicy).toBe('length(8)');
  });

  it('keeps authentication execution order', () => {
    const flow = {
      authenticationFlows: [
        {
          alias: 'browser',
          authenticationExecutions: [{ authenticator: 'z-first' }, { authenticator: 'a-second' }],
        },
      ],
    };
    const out = normalize(flow) as typeof flow;
    expect(
      out.authenticationFlows[0]!.authenticationExecutions.map((e) => e.authenticator),
    ).toEqual(['z-first', 'a-second']);
  });

  it('sorts plain string arrays', () => {
    expect(normalize({ redirectUris: ['b', 'a'] })).toEqual({ redirectUris: ['a', 'b'] });
  });

  it('is safe with __proto__ keys', () => {
    const v = JSON.parse('{"__proto__": {"polluted": true}}');
    const out = normalize(v) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
