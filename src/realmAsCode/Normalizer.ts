import { MASK } from '../util/redact';

/**
 * Turns a realm export into a canonical form so that diffs only show meaningful changes:
 * - server-generated ids are removed,
 * - object keys are sorted,
 * - arrays are sorted by a stable key (clientId, alias, name…), except where order matters,
 * - secrets are masked.
 * `normalize(normalize(x))` equals `normalize(x)`.
 */

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Generated per server; differ between environments and between imports. */
const DROP_KEYS = new Set(['id', '_id', 'containerId', 'parentId', 'internalId']);

/** Arrays where the order is meaningful and must be kept. */
const ORDERED_KEYS = new Set(['authenticationExecutions', 'requiredActions']);

/** Keys whose string values are secrets. Booleans/numbers (e.g. `revokeRefreshToken`) are kept. */
const SECRET_KEY =
  /^(secret|password|client[_.-]?secret|bindCredential|privateKey|private_key|keystorePassword|registrationAccessToken|.*[_.-]secret|.*[_.-]password)$/i;

/** Fields tried in order to sort arrays of objects. */
const SORT_KEYS = ['clientId', 'alias', 'name', 'username', 'providerId', 'protocol', 'type'];

export function normalize(value: unknown): Json {
  return norm(value as Json, undefined);
}

export function normalizeToString(value: unknown): string {
  return JSON.stringify(normalize(value), null, 2) + '\n';
}

function norm(v: Json, key: string | undefined): Json {
  if (Array.isArray(v)) {
    const items = v.map((x) => norm(x, undefined));
    return key !== undefined && ORDERED_KEYS.has(key) ? items : sortArray(items);
  }
  if (v !== null && typeof v === 'object') {
    const entries = Object.keys(v)
      .filter((k) => !DROP_KEYS.has(k))
      .sort()
      .map((k): [string, Json] => [k, SECRET_KEY.test(k) ? mask(v[k]!) : norm(v[k]!, k)]);
    // fromEntries defines own properties, so keys like "__proto__" are safe.
    return Object.fromEntries(entries);
  }
  return v;
}

function mask(v: Json): Json {
  if (typeof v === 'string') return v === '' ? v : MASK;
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? MASK : norm(x, undefined)));
  return norm(v, undefined);
}

function sortKey(x: Json): string {
  if (x !== null && typeof x === 'object' && !Array.isArray(x)) {
    for (const k of SORT_KEYS) {
      const s = x[k];
      if (typeof s === 'string') return `0:${k}:${s}`;
    }
  }
  return `1:${typeof x}:${JSON.stringify(x)}`;
}

function sortArray(items: Json[]): Json[] {
  return items
    .map((x) => ({ x, k: sortKey(x), full: JSON.stringify(x) }))
    .sort((a, b) => cmp(a.k, b.k) || cmp(a.full, b.full))
    .map((e) => e.x);
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
