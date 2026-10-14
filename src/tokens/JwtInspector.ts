import {
  decodeJwt,
  decodeProtectedHeader,
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
  const trimmed = token.trim().replace(/^Bearer\s+/i, '');
  const header = decodeProtectedHeader(trimmed);
  const payload = decodeJwt(trimmed) as DecodedJwt['payload'];
  const expiresInSeconds =
    typeof payload.exp === 'number' ? payload.exp - Math.floor(now / 1000) : undefined;
  return { header, payload, expiresInSeconds };
}
