/**
 * Explains why a user has (or lacks) a role in Keycloak by rebuilding the grant graph:
 * direct assignment, group membership (including parent groups) and composite roles.
 * Pure logic: data comes through `AccessSource`, so this is unit-testable and reusable.
 */

export interface Role {
  id: string;
  name: string;
  composite?: boolean;
  clientRole?: boolean;
  /** Client UUID for client roles. */
  containerId?: string;
  /** clientId, when already known. */
  clientId?: string;
}

export interface Group {
  id: string;
  name: string;
  path: string;
}

export interface AccessSource {
  userRoles(userId: string): Promise<Role[]>;
  userGroups(userId: string): Promise<Group[]>;
  groupByPath(path: string): Promise<Group>;
  groupRoles(groupId: string): Promise<Role[]>;
  composites(roleId: string): Promise<Role[]>;
  /** Maps a client UUID to its clientId. */
  clientIdOf(clientUuid: string): Promise<string>;
}

export type Hop =
  | { kind: 'user'; name: string }
  | { kind: 'group'; path: string; via: 'member' | 'parent' }
  | { kind: 'role'; name: string; client?: string; via: 'direct' | 'group' | 'composite' };

export interface RoleLabel {
  name: string;
  client?: string;
}

export interface Explanation {
  user: string;
  target: RoleLabel;
  has: boolean;
  /** Each path starts with the user and ends with the target role. Shortest first. */
  paths: Hop[][];
  /** Every role the user effectively has. */
  effective: RoleLabel[];
}

const MAX_PATHS = 6;
const MAX_DEPTH = 12;

export function roleKey(r: RoleLabel): string {
  return r.client ? `${r.client}:${r.name}` : r.name;
}

export async function explainRole(
  src: AccessSource,
  user: { id: string; username: string },
  targetRole: Role,
): Promise<Explanation> {
  const targetRoleId = targetRole.id;
  const clientIds = new Map<string, string>();
  const label = async (r: Role): Promise<RoleLabel> => {
    if (!r.clientRole) return { name: r.name };
    if (r.clientId) return { name: r.name, client: r.clientId };
    const uuid = r.containerId ?? '';
    if (!clientIds.has(uuid)) clientIds.set(uuid, await src.clientIdOf(uuid));
    return { name: r.name, client: clientIds.get(uuid) };
  };
  const compositeCache = new Map<string, Promise<Role[]>>();
  const children = (id: string) => {
    if (!compositeCache.has(id)) compositeCache.set(id, src.composites(id));
    return compositeCache.get(id)!;
  };

  // 1. Roots: roles reached directly or through groups (and their parents).
  const userHop: Hop = { kind: 'user', name: user.username };
  const roots: { prefix: Hop[]; role: Role; via: 'direct' | 'group' }[] = [];
  for (const r of await src.userRoles(user.id))
    roots.push({ prefix: [userHop], role: r, via: 'direct' });

  for (const g of await src.userGroups(user.id)) {
    const segs = g.path.split('/').filter(Boolean);
    const chain: Hop[] = [userHop, { kind: 'group', path: g.path, via: 'member' }];
    // Walk from the member group up to the top-level ancestor.
    for (let i = segs.length; i >= 1; i--) {
      const path = '/' + segs.slice(0, i).join('/');
      const grp = i === segs.length ? g : await src.groupByPath(path);
      if (i < segs.length) chain.push({ kind: 'group', path, via: 'parent' });
      for (const r of await src.groupRoles(grp.id)) {
        roots.push({ prefix: [...chain], role: r, via: 'group' });
      }
    }
  }

  // 2. Expand composites breadth-first from each root, keeping the path.
  const paths: Hop[][] = [];
  const effective = new Map<string, RoleLabel>();
  for (const root of roots) {
    const seen = new Set<string>();
    const queue: { role: Role; path: Hop[] }[] = [
      { role: root.role, path: [...root.prefix, await roleHop(root.role, root.via)] },
    ];
    while (queue.length) {
      const { role, path } = queue.shift()!;
      if (seen.has(role.id) || path.length > MAX_DEPTH) continue;
      seen.add(role.id);
      const l = await label(role);
      effective.set(roleKey(l), l);
      if (role.id === targetRoleId && paths.length < MAX_PATHS) paths.push(path);
      if (role.composite) {
        for (const c of await children(role.id)) {
          queue.push({ role: c, path: [...path, await roleHop(c, 'composite')] });
        }
      }
    }
  }

  async function roleHop(r: Role, via: 'direct' | 'group' | 'composite'): Promise<Hop> {
    const l = await label(r);
    return { kind: 'role', name: l.name, client: l.client, via };
  }

  paths.sort((a, b) => a.length - b.length);
  const unique = dedupe(paths);
  return {
    user: user.username,
    target: await label(targetRole),
    has: unique.length > 0,
    paths: unique,
    effective: [...effective.values()].sort((a, b) => roleKey(a).localeCompare(roleKey(b))),
  };
}

function dedupe(paths: Hop[][]): Hop[][] {
  const seen = new Set<string>();
  return paths.filter((p) => {
    const k = JSON.stringify(p);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Does the (example) access token payload carry the role? */
export function tokenHasRole(payload: Record<string, unknown>, role: RoleLabel): boolean {
  if (role.client) {
    const ra = payload.resource_access as Record<string, { roles?: unknown }> | undefined;
    const roles = ra?.[role.client]?.roles;
    return Array.isArray(roles) && roles.includes(role.name);
  }
  const roles = (payload.realm_access as { roles?: unknown } | undefined)?.roles;
  return Array.isArray(roles) && roles.includes(role.name);
}

/** One-sentence, human summary. */
export function summarize(
  e: Explanation,
  token?: { client: string; contains: boolean; fullScopeAllowed?: boolean },
): string {
  const role = e.target.client ? `${e.target.client} → ${e.target.name}` : e.target.name;
  if (!e.has) return `${e.user} does not have the role ${role}.`;
  const how = describePath(e.paths[0]!);
  if (!token) return `${e.user} has ${role} ${how}.`;
  if (token.contains)
    return `${e.user} has ${role} ${how}, and it is in the access token for ${token.client}.`;
  return (
    `${e.user} has ${role} ${how}, but access tokens for ${token.client} do not include it: ` +
    (token.fullScopeAllowed === false
      ? `the client has "Full scope allowed" off and this role is not in its scope mappings.`
      : `a client scope or mapper setting filters it out.`)
  );
}

export function describePath(path: Hop[]): string {
  const first = path[1];
  if (path.length === 2 && first?.kind === 'role' && first.via === 'direct') {
    return 'by direct assignment';
  }
  const parts: string[] = [];
  for (const h of path.slice(1)) {
    if (h.kind === 'user') continue;
    if (h.kind === 'group') {
      parts.push(
        h.via === 'member' ? `member of group ${h.path}` : `which inherits from ${h.path}`,
      );
      continue;
    }
    const r = `${h.client ? `${h.client} → ` : ''}${h.name}`;
    if (h.via === 'composite') parts.push(`which includes ${r}`);
    else if (h.via === 'direct') parts.push(`assigned ${r} directly`);
    else parts.push(`granting ${r}`);
  }
  return `(${parts.join(', ')})`;
}
