import {
  createRemoteJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  errors,
  jwtVerify,
  type JWTPayload,
  type ProtectedHeaderParameters,
} from 'jose';

export interface DecodedJwt {
  header: ProtectedHeaderParameters;
  payload: JWTPayload & Record<string, unknown>;
  expiresInSeconds?: number;
}

/** Offline decode (no signature verification). */
export function decode(token: string, now = Date.now()): DecodedJwt {
  const trimmed = stripBearer(token);
  const header = decodeProtectedHeader(trimmed);
  const payload = decodeJwt(trimmed) as DecodedJwt['payload'];
  const expiresInSeconds =
    typeof payload.exp === 'number' ? payload.exp - Math.floor(now / 1000) : undefined;
  return { header, payload, expiresInSeconds };
}

export function stripBearer(token: string): string {
  return token.trim().replace(/^Bearer\s+/i, '');
}

export type VerifyResult =
  | { status: 'valid' }
  | { status: 'expired' } // signature valid, token expired
  | { status: 'invalid'; reason: string }
  | { status: 'unverified'; reason: string }; // could not check (e.g. JWKS unreachable)

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** Verify the signature against a JWKS URL (and the issuer, if given). */
export async function verify(
  token: string,
  jwksUri: string,
  issuer?: string,
): Promise<VerifyResult> {
  let jwks = jwksCache.get(jwksUri);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUri), { timeoutDuration: 5000 });
    jwksCache.set(jwksUri, jwks);
  }
  try {
    await jwtVerify(stripBearer(token), jwks, issuer ? { issuer } : {});
    return { status: 'valid' };
  } catch (e) {
    if (e instanceof errors.JWTExpired) return { status: 'expired' };
    if (e instanceof errors.JWKSTimeout || (e instanceof TypeError && /fetch/i.test(e.message))) {
      return { status: 'unverified', reason: `Could not load signing keys from ${jwksUri}.` };
    }
    if (e instanceof errors.JOSEError) return { status: 'invalid', reason: e.message };
    return { status: 'unverified', reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Verify using the token's own `iss` (discovers the JWKS). Used for tokens pasted in an editor.
 * Only http(s) issuers are contacted.
 */
export async function verifyByIssuer(
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<VerifyResult> {
  const { payload } = decode(token);
  const iss = typeof payload.iss === 'string' ? payload.iss : undefined;
  if (!iss || !/^https?:\/\//.test(iss)) {
    return { status: 'unverified', reason: 'Token has no http(s) issuer.' };
  }
  try {
    const res = await fetchFn(`${iss.replace(/\/+$/, '')}/.well-known/openid-configuration`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { status: 'unverified', reason: `Issuer returned HTTP ${res.status}.` };
    const { jwks_uri } = (await res.json()) as { jwks_uri?: string };
    if (!jwks_uri) return { status: 'unverified', reason: 'Issuer has no jwks_uri.' };
    return await verify(token, jwks_uri, iss);
  } catch {
    return { status: 'unverified', reason: `Issuer ${iss} is not reachable.` };
  }
}

export interface ClaimNote {
  claim: string;
  value: unknown;
  explanation?: string;
}

export interface ClaimAnnotations {
  realmRoles: string[];
  clientRoles: Record<string, string[]>;
  scopes: string[];
  audience: string[];
  groups: string[];
  authorizedParty?: string;
  standard: ClaimNote[];
  custom: ClaimNote[];
}

const STANDARD: Record<string, string> = {
  iss: 'Issuer: the realm that issued the token.',
  sub: 'Subject: the user (or service account) ID.',
  aud: 'Audience: who the token is meant for. APIs should check they are listed.',
  exp: 'Expiry time. The token is rejected after this.',
  iat: 'Issued at.',
  nbf: 'Not valid before this time.',
  auth_time: 'When the user actually authenticated.',
  jti: 'Unique token ID.',
  azp: 'Authorized party: the client that requested the token.',
  typ: 'Keycloak token type (Bearer, ID, Refresh…).',
  sid: 'Keycloak session ID.',
  session_state: 'Keycloak session ID (older name).',
  nonce: 'Echo of the nonce sent in the login request (replay protection).',
  acr: 'Authentication context class: how strongly the user authenticated.',
  amr: 'Authentication methods used.',
  scope: 'Granted OAuth scopes.',
  realm_access: 'Realm roles (effective, including composites and groups).',
  resource_access: 'Client roles, per client.',
  'allowed-origins': 'Web origins allowed for CORS with this token.',
  preferred_username: 'Username.',
  email: 'Email address.',
  email_verified: 'Whether the email was verified.',
  name: 'Full name.',
  given_name: 'First name.',
  family_name: 'Last name.',
  groups: 'Group membership (needs a group mapper).',
  client_id: 'Client ID (service-account tokens).',
  clientHost: 'IP of the client (service-account tokens).',
  clientAddress: 'IP of the client (service-account tokens).',
};

const TIME_CLAIMS = new Set(['exp', 'iat', 'nbf', 'auth_time']);

export function annotateClaims(payload: Record<string, unknown>): ClaimAnnotations {
  const realmRoles = asStrings((payload.realm_access as { roles?: unknown } | undefined)?.roles);
  const clientRoles: Record<string, string[]> = {};
  const ra = payload.resource_access;
  if (ra && typeof ra === 'object') {
    for (const [client, v] of Object.entries(ra as Record<string, { roles?: unknown }>)) {
      clientRoles[client] = asStrings(v?.roles);
    }
  }
  const standard: ClaimNote[] = [];
  const custom: ClaimNote[] = [];
  for (const [claim, value] of Object.entries(payload)) {
    const explanation = STANDARD[claim];
    const shown =
      TIME_CLAIMS.has(claim) && typeof value === 'number'
        ? `${value} (${new Date(value * 1000).toISOString()})`
        : value;
    (explanation ? standard : custom).push({ claim, value: shown, explanation });
  }
  const aud = payload.aud;
  return {
    realmRoles,
    clientRoles,
    scopes: typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [],
    audience: typeof aud === 'string' ? [aud] : asStrings(aud),
    groups: asStrings(payload.groups),
    authorizedParty: typeof payload.azp === 'string' ? payload.azp : undefined,
    standard,
    custom,
  };
}

function asStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
