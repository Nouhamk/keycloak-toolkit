import { describe, expect, it } from 'vitest';
import { decode } from '../../src/tokens/JwtInspector';

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = `${b64({ alg: 'RS256', kid: 'k1' })}.${b64({ sub: 'alice', exp: 2000 })}.sig`;

describe('JwtInspector.decode', () => {
  it('decodes header, payload and expiry', () => {
    const d = decode(`Bearer ${token}`, 1000 * 1000);
    expect(d.header.kid).toBe('k1');
    expect(d.payload.sub).toBe('alice');
    expect(d.expiresInSeconds).toBe(1000);
  });
  it('throws on garbage', () => {
    expect(() => decode('nope')).toThrow();
  });
});
