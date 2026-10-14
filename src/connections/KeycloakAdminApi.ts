import { redact } from '../util/redact';
import type { Connection } from './types';

/**
 * Thin Admin REST client over `fetch`.
 *
 * We use direct `fetch` instead of `@keycloak/keycloak-admin-client` because that package is
 * ESM-only with a large dependency tree, and we only need a handful of stable read endpoints.
 * Endpoints used (Keycloak Admin REST API):
 *   POST /realms/{realm}/protocol/openid-connect/token
 *   GET  /admin/serverinfo
 *   GET  /admin/realms
 *   GET  /admin/realms/{realm}/clients | users | roles | groups
 */

export type FetchFn = typeof fetch;

export interface RealmSummary {
  realm: string;
  displayName?: string;
  enabled?: boolean;
}
export interface ClientSummary {
  id: string;
  clientId: string;
  publicClient?: boolean;
  enabled?: boolean;
}
export interface UserSummary {
  id: string;
  username: string;
  email?: string;
  enabled?: boolean;
}
export interface RoleSummary {
  id: string;
  name: string;
  composite?: boolean;
  description?: string;
}
export interface GroupSummary {
  id: string;
  name: string;
  path?: string;
  subGroupCount?: number;
}

export class KeycloakApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(redact(message));
  }
}

interface CachedToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export interface AdminApiOptions {
  fetch?: FetchFn;
  timeoutMs?: number;
  now?: () => number;
}

export class KeycloakAdminApi {
  private token?: CachedToken;
  private readonly fetchFn: FetchFn;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(
    readonly connection: Connection,
    private readonly secret: string,
    opts: AdminApiOptions = {},
  ) {
    this.fetchFn = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.now = opts.now ?? Date.now;
  }

  async serverVersion(): Promise<string> {
    const info = await this.get<{ systemInfo?: { version?: string } }>('/admin/serverinfo');
    return info.systemInfo?.version ?? 'unknown';
  }

  listRealms(): Promise<RealmSummary[]> {
    return this.get('/admin/realms?briefRepresentation=true');
  }

  listClients(realm: string, search?: string, max = 100): Promise<ClientSummary[]> {
    const q = new URLSearchParams({ first: '0', max: String(max) });
    if (search) {
      q.set('clientId', search);
      q.set('search', 'true');
    }
    return this.get(`/admin/realms/${enc(realm)}/clients?${q}`);
  }

  listUsers(realm: string, search?: string, max = 100): Promise<UserSummary[]> {
    const q = new URLSearchParams({ first: '0', max: String(max), briefRepresentation: 'true' });
    if (search) q.set('search', search);
    return this.get(`/admin/realms/${enc(realm)}/users?${q}`);
  }

  listRealmRoles(realm: string, search?: string, max = 100): Promise<RoleSummary[]> {
    const q = new URLSearchParams({ first: '0', max: String(max), briefRepresentation: 'true' });
    if (search) q.set('search', search);
    return this.get(`/admin/realms/${enc(realm)}/roles?${q}`);
  }

  listGroups(realm: string, search?: string, max = 100): Promise<GroupSummary[]> {
    const q = new URLSearchParams({ first: '0', max: String(max), briefRepresentation: 'true' });
    if (search) q.set('search', search);
    return this.get(`/admin/realms/${enc(realm)}/groups?${q}`);
  }

  // --- internals -----------------------------------------------------------

  private async get<T>(path: string): Promise<T> {
    const token = await this.accessToken();
    let res = await this.request(path, { headers: { authorization: `Bearer ${token}` } });
    if (res.status === 401) {
      this.token = undefined;
      const fresh = await this.accessToken();
      res = await this.request(path, { headers: { authorization: `Bearer ${fresh}` } });
    }
    if (!res.ok) throw await httpError(res, `GET ${path.split('?')[0]}`);
    return (await res.json()) as T;
  }

  /** Returns a valid admin access token, refreshing or re-authenticating as needed. */
  async accessToken(): Promise<string> {
    const skewMs = 10_000;
    if (this.token && this.token.expiresAt - skewMs > this.now()) return this.token.accessToken;

    const c = this.connection;
    const body = new URLSearchParams();
    if (this.token?.refreshToken) {
      body.set('grant_type', 'refresh_token');
      body.set('refresh_token', this.token.refreshToken);
      body.set('client_id', c.authMethod === 'password' ? 'admin-cli' : c.principal);
      if (c.authMethod === 'client_credentials') body.set('client_secret', this.secret);
      const ok = await this.tokenRequest(body).catch(() => false);
      if (ok) return this.token!.accessToken;
      this.token = undefined;
      return this.accessToken();
    }

    if (c.authMethod === 'password') {
      body.set('grant_type', 'password');
      body.set('client_id', 'admin-cli');
      body.set('username', c.principal);
      body.set('password', this.secret);
    } else {
      body.set('grant_type', 'client_credentials');
      body.set('client_id', c.principal);
      body.set('client_secret', this.secret);
    }
    await this.tokenRequest(body);
    return this.token!.accessToken;
  }

  private async tokenRequest(body: URLSearchParams): Promise<true> {
    const path = `/realms/${enc(this.connection.authRealm)}/protocol/openid-connect/token`;
    const res = await this.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw await httpError(res, 'Admin login');
    const json = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };
    this.token = {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: this.now() + json.expires_in * 1000,
    };
    return true;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const url = this.connection.baseUrl + path;
    try {
      return await this.fetchFn(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (e) {
      throw new KeycloakApiError(describeNetworkError(e, this.connection.baseUrl));
    }
  }
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

async function httpError(res: Response, what: string): Promise<KeycloakApiError> {
  let detail = '';
  try {
    const j = (await res.json()) as { error_description?: string; error?: string };
    detail = j.error_description ?? j.error ?? '';
  } catch {
    /* body not JSON */
  }
  const hint =
    res.status === 401
      ? ' Check the username/client and secret.'
      : res.status === 403
        ? ' The account lacks admin permissions (e.g. view-realm, view-clients, view-users).'
        : res.status === 404
          ? ' Check the URL and realm name.'
          : '';
  return new KeycloakApiError(
    `${what} failed (HTTP ${res.status}${detail ? `: ${detail}` : ''}).${hint}`,
    res.status,
  );
}

export function describeNetworkError(e: unknown, baseUrl: string): string {
  const err = e as { name?: string; message?: string; cause?: { code?: string } };
  const code = err.cause?.code ?? '';
  if (err.name === 'TimeoutError') return `Timed out reaching ${baseUrl}. Is the server up?`;
  if (code === 'ECONNREFUSED') return `Connection refused at ${baseUrl}. Is Keycloak running?`;
  if (code === 'ENOTFOUND') return `Host not found for ${baseUrl}. Check the URL.`;
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) {
    return `TLS certificate for ${baseUrl} is not trusted (${code}). Add the CA to your system trust store.`;
  }
  return `Could not reach ${baseUrl}: ${err.message ?? String(e)}`;
}
