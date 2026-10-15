import { describe, expect, it } from 'vitest';
import { KeycloakAdminApi } from '../../src/connections/KeycloakAdminApi';

const BASE = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';

describe('KeycloakAdminApi against docker stack', () => {
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

  it('reads the server version', async () => {
    expect(await api.serverVersion()).toMatch(/^\d+\./);
  });

  it('lists the demo realm and its content', async () => {
    expect((await api.listRealms()).map((r) => r.realm)).toContain('demo');
    const clients = (await api.listClients('demo')).map((c) => c.clientId);
    expect(clients).toEqual(expect.arrayContaining(['reports-backend', 'reports-spa']));
    expect((await api.listUsers('demo')).map((u) => u.username).sort()).toEqual([
      'alice',
      'bob',
      'carol',
    ]);
    expect((await api.listRealmRoles('demo')).map((r) => r.name)).toEqual(
      expect.arrayContaining(['reports-viewer', 'reports-admin']),
    );
    expect((await api.listGroups('demo')).map((g) => g.name).sort()).toEqual([
      'admins',
      'analysts',
      'finance',
    ]);
  });

  it('filters clients', async () => {
    const clients = await api.listClients('demo', 'reports-spa');
    expect(clients.map((c) => c.clientId)).toEqual(['reports-spa']);
  });
});
