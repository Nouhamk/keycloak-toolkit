import { describe, expect, it } from 'vitest';
import {
  describePath,
  explainRole,
  summarize,
  tokenHasRole,
  type AccessSource,
  type Group,
  type Role,
} from '../../src/access/AccessExplainer';

const R = (id: string, extra: Partial<Role> = {}): Role => ({ id, name: id, ...extra });

const roles = {
  viewer: R('viewer', { composite: true }),
  admin: R('admin', { composite: true }),
  read: R('read', { clientRole: true, containerId: 'uuid-backend' }),
  exportR: R('export', { clientRole: true, containerId: 'uuid-backend' }),
  billing: R('billing'),
};

function source(user: { roles?: Role[]; groups?: Group[] }): AccessSource {
  const groups: Record<string, Group> = {
    '/analysts': { id: 'g-analysts', name: 'analysts', path: '/analysts' },
    '/analysts/senior': { id: 'g-senior', name: 'senior', path: '/analysts/senior' },
    '/admins': { id: 'g-admins', name: 'admins', path: '/admins' },
  };
  const groupRoles: Record<string, Role[]> = {
    'g-analysts': [roles.viewer],
    'g-senior': [roles.exportR],
    'g-admins': [roles.admin],
  };
  const composites: Record<string, Role[]> = {
    viewer: [roles.read],
    admin: [roles.viewer],
  };
  return {
    userRoles: async () => user.roles ?? [],
    userGroups: async () => user.groups ?? [],
    groupByPath: async (p) => groups[p]!,
    groupRoles: async (id) => groupRoles[id] ?? [],
    composites: async (id) => composites[id] ?? [],
    clientIdOf: async () => 'reports-backend',
  };
}

const alice = { id: 'u1', username: 'alice' };
const analysts = { id: 'g-analysts', name: 'analysts', path: '/analysts' };
const senior = { id: 'g-senior', name: 'senior', path: '/analysts/senior' };
const admins = { id: 'g-admins', name: 'admins', path: '/admins' };

describe('explainRole', () => {
  it('direct assignment', async () => {
    const e = await explainRole(source({ roles: [roles.billing] }), alice, roles.billing);
    expect(e.has).toBe(true);
    expect(e.paths).toHaveLength(1);
    expect(describePath(e.paths[0]!)).toBe('by direct assignment');
  });

  it('through a group', async () => {
    const e = await explainRole(source({ groups: [analysts] }), alice, roles.viewer);
    expect(e.has).toBe(true);
    expect(e.paths[0]!.map((h) => h.kind)).toEqual(['user', 'group', 'role']);
  });

  it('through a group, then a composite, to a client role', async () => {
    const e = await explainRole(source({ groups: [admins] }), alice, roles.read);
    expect(e.has).toBe(true);
    expect(e.target).toEqual({ name: 'read', client: 'reports-backend' });
    expect(describePath(e.paths[0]!)).toBe(
      '(member of group /admins, granting admin, which includes viewer, which includes reports-backend → read)',
    );
  });

  it('inherits roles from parent groups', async () => {
    const e = await explainRole(source({ groups: [senior] }), alice, roles.viewer);
    expect(e.has).toBe(true);
    const groupsInPath = e.paths[0]!.filter((h) => h.kind === 'group');
    expect(groupsInPath).toEqual([
      { kind: 'group', path: '/analysts/senior', via: 'member' },
      { kind: 'group', path: '/analysts', via: 'parent' },
    ]);
  });

  it('lists every distinct path, shortest first', async () => {
    const e = await explainRole(
      source({ roles: [roles.viewer], groups: [analysts, admins] }),
      alice,
      roles.viewer,
    );
    expect(e.paths.length).toBe(3);
    expect(e.paths[0]!.length).toBeLessThanOrEqual(e.paths[1]!.length);
  });

  it('reports a missing role and the effective roles', async () => {
    const e = await explainRole(source({ groups: [analysts] }), alice, roles.admin);
    expect(e.has).toBe(false);
    expect(e.paths).toEqual([]);
    expect(e.target).toEqual({ name: 'admin' });
    expect(e.effective.map((r) => r.name).sort()).toEqual(['read', 'viewer']);
    expect(summarize(e)).toBe('alice does not have the role admin.');
  });

  it('survives composite cycles', async () => {
    const a = R('a', { composite: true });
    const b = R('b', { composite: true });
    const src: AccessSource = {
      ...source({ roles: [a] }),
      composites: async (id) => (id === 'a' ? [b] : [a]),
    };
    const e = await explainRole(src, alice, b);
    expect(e.has).toBe(true);
  });
});

describe('token check and summary', () => {
  const payload = {
    realm_access: { roles: ['viewer'] },
    resource_access: { 'reports-backend': { roles: ['read'] } },
  };
  it('finds realm and client roles in a token', () => {
    expect(tokenHasRole(payload, { name: 'viewer' })).toBe(true);
    expect(tokenHasRole(payload, { name: 'read', client: 'reports-backend' })).toBe(true);
    expect(tokenHasRole(payload, { name: 'read' })).toBe(false);
    expect(tokenHasRole({}, { name: 'viewer' })).toBe(false);
  });

  it('explains when the client scope filters the role', async () => {
    const e = await explainRole(source({ groups: [analysts] }), alice, roles.viewer);
    expect(
      summarize(e, { client: 'billing-app', contains: false, fullScopeAllowed: false }),
    ).toMatch(/do not include it: the client has "Full scope allowed" off/);
  });
});
