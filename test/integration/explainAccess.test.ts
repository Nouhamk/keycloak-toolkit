import { describe, expect, it } from 'vitest';
import { explainRole, summarize, tokenHasRole, type Role } from '../../src/access/AccessExplainer';
import { adminAccessSource } from '../../src/access/adminAccessSource';
import { KeycloakAdminApi } from '../../src/connections/KeycloakAdminApi';

const BASE = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const api = new KeycloakAdminApi(
  {
    id: 'it',
    name: 'it',
    baseUrl: BASE,
    authRealm: 'master',
    authMethod: 'password',
    principal: 'admin',
    environment: 'local',
  },
  'admin',
);
const realm = 'demo';
const src = adminAccessSource(api, realm);

async function user(username: string) {
  const u = (await api.listUsers(realm, username)).find((x) => x.username === username)!;
  return { id: u.id, username };
}
async function realmRole(name: string): Promise<Role> {
  const r = (await api.listRealmRoles(realm, name)).find((x) => x.name === name)!;
  return { ...r, clientRole: false };
}
async function client(clientId: string) {
  return (await api.listClients(realm, clientId)).find((c) => c.clientId === clientId)!;
}
async function clientRole(clientId: string, name: string): Promise<Role> {
  const c = await client(clientId);
  const r = (await api.listClientRoles(realm, c.id)).find((x) => x.name === name)!;
  return { ...r, clientRole: true, containerId: c.id, clientId };
}

describe('explain access against the demo realm', () => {
  it('alice has reports-viewer through the analysts group', async () => {
    const e = await explainRole(src, await user('alice'), await realmRole('reports-viewer'));
    expect(e.has).toBe(true);
    expect(e.paths[0]!.map((h) => (h.kind === 'group' ? h.path : h.kind))).toEqual([
      'user',
      '/analysts',
      'role',
    ]);
  });

  it('alice lacks reports-admin; the admins group grants it', async () => {
    const role = await realmRole('reports-admin');
    const e = await explainRole(src, await user('alice'), role);
    expect(e.has).toBe(false);
    expect(summarize(e)).toBe('alice does not have the role reports-admin.');
    const groups = await api.getRoleGroups(realm, 'reports-admin');
    expect(groups.map((g) => g.name)).toEqual(['admins']);
  });

  it('bob gets reports-backend → read via admins → reports-admin → reports-viewer', async () => {
    const e = await explainRole(
      src,
      await user('bob'),
      await clientRole('reports-backend', 'read'),
    );
    expect(e.has).toBe(true);
    expect(e.target).toEqual({ name: 'read', client: 'reports-backend' });
    const roles = e.paths[0]!.flatMap((h) => (h.kind === 'role' ? [h.name] : []));
    expect(roles).toEqual(['reports-admin', 'reports-viewer', 'read']);
  });

  it('carol inherits reports-viewer from the parent of /analysts/senior', async () => {
    const e = await explainRole(src, await user('carol'), await realmRole('reports-viewer'));
    expect(e.has).toBe(true);
    const groups = e.paths[0]!.flatMap((h) => (h.kind === 'group' ? [`${h.via}:${h.path}`] : []));
    expect(groups).toEqual(['member:/analysts/senior', 'parent:/analysts']);
  });

  it('token preview: reports-spa carries the role, billing-app filters it out', async () => {
    const alice = await user('alice');
    const target = { name: 'reports-viewer' };
    const spa = await api.exampleAccessToken(realm, (await client('reports-spa')).id, alice.id);
    expect(tokenHasRole(spa, target)).toBe(true);
    const billing = await client('billing-app');
    const filtered = await api.exampleAccessToken(realm, billing.id, alice.id);
    expect(tokenHasRole(filtered, target)).toBe(false);
    expect((await api.getClient(realm, billing.id)).fullScopeAllowed).toBe(false);
  });
});
