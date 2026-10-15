import { afterAll, describe, expect, it } from 'vitest';
import { KeycloakAdminApi } from '../../src/connections/KeycloakAdminApi';
import { exportRealm } from '../../src/realmAsCode/RealmExporter';

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

/** Test-only write helper (the extension itself has no write actions yet). */
async function updateClient(id: string, patch: Record<string, unknown>): Promise<void> {
  const url = `${BASE}/admin/realms/demo/clients/${id}`;
  const headers = { authorization: `Bearer ${await api.accessToken()}` };
  const current = (await (await fetch(url, { headers })).json()) as Record<string, unknown>;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ ...current, ...patch }),
  });
  expect(res.status).toBe(204);
}

function changedLines(a: string, b: string): string[] {
  const al = a.split('\n');
  const bl = b.split('\n');
  expect(bl.length).toBe(al.length);
  return al.flatMap((line, i) => (line === bl[i] ? [] : [`- ${line.trim()} + ${bl[i]!.trim()}`]));
}

describe('realm export + normalization against the demo realm', () => {
  let spaId: string;

  afterAll(async () => {
    if (spaId) await updateClient(spaId, { consentRequired: false });
  });

  it('exports without real users or secrets', async () => {
    const text = await exportRealm(api, 'demo');
    const realm = JSON.parse(text) as { realm: string; users?: { username: string }[] };
    expect(realm.realm).toBe('demo');
    // Only service-account users (they hold the client's roles), never real users.
    for (const u of realm.users ?? []) expect(u.username).toMatch(/^service-account-/);
    expect(text).not.toMatch(/alice|bob/);
    expect(text).not.toContain('dev-only-secret');
    expect(text).not.toMatch(/"id":/);
  });

  it('two exports without changes are identical (no noise)', async () => {
    expect(await exportRealm(api, 'demo')).toBe(await exportRealm(api, 'demo'));
  });

  it('one client setting change produces exactly one changed line', async () => {
    spaId = (await api.listClients('demo', 'reports-spa'))[0]!.id;
    const before = await exportRealm(api, 'demo');
    await updateClient(spaId, { consentRequired: true });
    const after = await exportRealm(api, 'demo');
    const diff = changedLines(before, after);
    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatch(/"consentRequired": false.*"consentRequired": true/);
  });
});
