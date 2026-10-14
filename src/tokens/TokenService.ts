import { createHash, randomBytes } from 'node:crypto';
import { redact } from '../util/redact';

/**
 * OIDC/OAuth2 flows against a Keycloak realm. No `vscode` imports.
 * Endpoints are read from /realms/{realm}/.well-known/openid-configuration.
 */

export type FetchFn = typeof fetch;

export interface OidcEndpoints {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  introspection_endpoint: string;
  jwks_uri: string;
  device_authorization_endpoint?: string;
}

export interface TokenSet {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  refresh_expires_in?: number;
  id_token?: string;
  scope?: string;
}

export interface ClientCredentials {
  clientId: string;
  /** Present for confidential clients. Never persisted. */
  clientSecret?: string;
}

export interface DeviceAuthorization {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
}

export class TokenError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(redact(message));
  }
}

export interface TokenServiceOptions {
  fetch?: FetchFn;
  timeoutMs?: number;
}

export const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

export class TokenService {
  private endpoints?: OidcEndpoints;
  private readonly fetchFn: FetchFn;
  private readonly timeoutMs: number;

  constructor(
    readonly baseUrl: string,
    readonly realm: string,
    opts: TokenServiceOptions = {},
  ) {
    this.fetchFn = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  async discover(): Promise<OidcEndpoints> {
    if (this.endpoints) return this.endpoints;
    const url = `${this.baseUrl}/realms/${encodeURIComponent(this.realm)}/.well-known/openid-configuration`;
    const res = await this.send(url, {});
    if (!res.ok) {
      throw new TokenError(
        `Could not load OIDC configuration (HTTP ${res.status}). Check the realm name.`,
      );
    }
    this.endpoints = (await res.json()) as OidcEndpoints;
    return this.endpoints;
  }

  clientCredentials(c: ClientCredentials, scope?: string): Promise<TokenSet> {
    return this.tokenRequest(c, { grant_type: 'client_credentials', ...(scope ? { scope } : {}) });
  }

  /** Resource Owner Password grant. Legacy; only offered behind a setting. */
  password(
    c: ClientCredentials,
    username: string,
    password: string,
    scope?: string,
  ): Promise<TokenSet> {
    return this.tokenRequest(c, {
      grant_type: 'password',
      username,
      password,
      ...(scope ? { scope } : {}),
    });
  }

  refresh(c: ClientCredentials, refreshToken: string): Promise<TokenSet> {
    return this.tokenRequest(c, { grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  async authorizationUrl(
    c: ClientCredentials,
    p: { redirectUri: string; state: string; codeChallenge: string; scope: string; nonce?: string },
  ): Promise<string> {
    const { authorization_endpoint } = await this.discover();
    const u = new URL(authorization_endpoint);
    u.search = new URLSearchParams({
      response_type: 'code',
      client_id: c.clientId,
      redirect_uri: p.redirectUri,
      scope: p.scope,
      state: p.state,
      code_challenge: p.codeChallenge,
      code_challenge_method: 'S256',
      ...(p.nonce ? { nonce: p.nonce } : {}),
    }).toString();
    return u.toString();
  }

  exchangeCode(
    c: ClientCredentials,
    code: string,
    redirectUri: string,
    verifier: string,
  ): Promise<TokenSet> {
    return this.tokenRequest(c, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
  }

  /**
   * Starts the device flow. Always uses PKCE (Keycloak requires it when the client enforces
   * `pkce.code.challenge.method`); the verifier is returned for `pollDeviceToken`.
   */
  async startDeviceAuthorization(
    c: ClientCredentials,
    scope?: string,
  ): Promise<DeviceAuthorization & { codeVerifier: string }> {
    const { device_authorization_endpoint } = await this.discover();
    if (!device_authorization_endpoint) {
      throw new TokenError('This Keycloak does not advertise a device authorization endpoint.');
    }
    const pkce = createPkce();
    const res = await this.postForm(device_authorization_endpoint, c, {
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
      ...(scope ? { scope } : {}),
    });
    if (!res.ok) throw await oauthError(res, 'Device authorization');
    return { ...((await res.json()) as DeviceAuthorization), codeVerifier: pkce.verifier };
  }

  /** Polls the token endpoint until the user approves, denies, or the code expires. */
  async pollDeviceToken(
    c: ClientCredentials,
    d: DeviceAuthorization & { codeVerifier?: string },
    opts: { signal?: AbortSignal; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
  ): Promise<TokenSet> {
    const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const now = opts.now ?? Date.now;
    const deadline = now() + d.expires_in * 1000;
    let interval = (d.interval ?? 5) * 1000;
    const { token_endpoint } = await this.discover();
    while (now() < deadline) {
      if (opts.signal?.aborted) throw new TokenError('Cancelled.', 'cancelled');
      await sleep(interval);
      const res = await this.postForm(token_endpoint, c, {
        grant_type: DEVICE_GRANT,
        device_code: d.device_code,
        ...(d.codeVerifier ? { code_verifier: d.codeVerifier } : {}),
      });
      if (res.ok) return (await res.json()) as TokenSet;
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      if (err.error === 'authorization_pending') continue;
      if (err.error === 'slow_down') {
        interval += 5000;
        continue;
      }
      throw new TokenError(`Device login failed: ${err.error ?? `HTTP ${res.status}`}.`, err.error);
    }
    throw new TokenError(
      'The device code expired before the login was completed.',
      'expired_token',
    );
  }

  /** Token introspection (RFC 7662). Keycloak requires confidential client credentials. */
  async introspect(c: ClientCredentials, token: string): Promise<Record<string, unknown>> {
    const { introspection_endpoint } = await this.discover();
    const res = await this.postForm(introspection_endpoint, c, { token });
    if (!res.ok) throw await oauthError(res, 'Introspection');
    return (await res.json()) as Record<string, unknown>;
  }

  async userinfo(accessToken: string): Promise<Record<string, unknown>> {
    const { userinfo_endpoint } = await this.discover();
    const res = await this.send(userinfo_endpoint, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw await oauthError(res, 'Userinfo');
    return (await res.json()) as Record<string, unknown>;
  }

  // --- internals -----------------------------------------------------------

  private async tokenRequest(
    c: ClientCredentials,
    params: Record<string, string>,
  ): Promise<TokenSet> {
    const { token_endpoint } = await this.discover();
    const res = await this.postForm(token_endpoint, c, params);
    if (!res.ok) throw await oauthError(res, 'Token request');
    return (await res.json()) as TokenSet;
  }

  private postForm(
    url: string,
    c: ClientCredentials,
    params: Record<string, string>,
  ): Promise<Response> {
    const body = new URLSearchParams({ client_id: c.clientId, ...params });
    if (c.clientSecret) body.set('client_secret', c.clientSecret);
    return this.send(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchFn(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (e) {
      const err = e as { name?: string; message?: string; cause?: { code?: string } };
      if (err.name === 'TimeoutError')
        throw new TokenError(`Timed out calling ${new URL(url).origin}.`);
      throw new TokenError(
        `Could not reach ${new URL(url).origin}: ${err.cause?.code ?? err.message}`,
      );
    }
  }
}

async function oauthError(res: Response, what: string): Promise<TokenError> {
  const j = (await res.json().catch(() => ({}))) as { error?: string; error_description?: string };
  const detail = j.error_description ?? j.error ?? '';
  const hints: Record<string, string> = {
    unauthorized_client:
      ' The client is not allowed to use this grant. Enable it in the client settings.',
    invalid_client: ' Check the client ID and secret.',
    invalid_grant: ' The code, credentials or refresh token are invalid or expired.',
    invalid_scope: ' One of the requested scopes is not assigned to the client.',
  };
  // Keycloak reports a bad client secret as `unauthorized_client` + "Invalid client credentials".
  const hint = /invalid client/i.test(detail)
    ? ' Check the client ID and secret.'
    : (hints[j.error ?? ''] ?? '');
  return new TokenError(
    `${what} failed (HTTP ${res.status}${detail ? `: ${detail}` : ''}).${hint}`,
    j.error,
  );
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function randomState(): string {
  return randomBytes(16).toString('base64url');
}

/** `curl` command that calls an API with the token. */
export function toCurl(accessToken: string, url: string): string {
  return `curl -H 'Authorization: Bearer ${accessToken}' '${url}'`;
}
