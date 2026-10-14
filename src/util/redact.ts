export const MASK = '**********';

const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
const BEARER_RE = /(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi;
const KV_RE =
  /("?(?:client_secret|secret|password|access_token|refresh_token|id_token|token)"?\s*[:=]\s*"?)([^"&\s,}]+)/gi;

/** Mask tokens and secrets in any string. Every log/notification must pass through this. */
export function redact(input: string): string {
  return input.replace(JWT_RE, MASK).replace(BEARER_RE, `$1${MASK}`).replace(KV_RE, `$1${MASK}`);
}
