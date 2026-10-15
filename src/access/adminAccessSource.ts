import type { KeycloakAdminApi, RoleMappings } from '../connections/KeycloakAdminApi';
import type { AccessSource, Role } from './AccessExplainer';

export function flattenMappings(m: RoleMappings): Role[] {
  const out: Role[] = [...(m.realmMappings ?? []).map((r) => ({ ...r, clientRole: false }))];
  for (const entry of Object.values(m.clientMappings ?? {})) {
    for (const r of entry.mappings) {
      out.push({ ...r, clientRole: true, containerId: entry.id, clientId: entry.client });
    }
  }
  return out;
}

export function adminAccessSource(api: KeycloakAdminApi, realm: string): AccessSource {
  return {
    userRoles: async (id) => flattenMappings(await api.getUserRoleMappings(realm, id)),
    userGroups: async (id) =>
      (await api.getUserGroups(realm, id)).map((g) => ({
        id: g.id,
        name: g.name,
        path: g.path ?? `/${g.name}`,
      })),
    groupByPath: async (path) => {
      const g = await api.getGroupByPath(realm, path);
      return { id: g.id, name: g.name, path: g.path ?? path };
    },
    groupRoles: async (id) => flattenMappings(await api.getGroupRoleMappings(realm, id)),
    composites: (id) => api.getRoleComposites(realm, id),
    clientIdOf: async (uuid) => (await api.getClient(realm, uuid)).clientId,
  };
}
