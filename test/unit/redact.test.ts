import { describe, expect, it } from 'vitest';
import { MASK, redact } from '../../src/util/redact';

describe('redact', () => {
  it('masks JWTs', () => {
    expect(redact('token eyJhbGciOi.eyJzdWIiOiIx.sig here')).toBe(`token ${MASK} here`);
  });
  it('masks bearer headers', () => {
    expect(redact('Authorization: Bearer abc.def')).toBe(`Authorization: Bearer ${MASK}`);
  });
  it('masks secrets in form and JSON', () => {
    expect(redact('client_secret=s3cr3t&x=1')).toBe(`client_secret=${MASK}&x=1`);
    expect(redact('{"secret":"s3cr3t"}')).toBe(`{"secret":"${MASK}"}`);
  });
  it('leaves normal text alone', () => {
    expect(redact('realm demo loaded')).toBe('realm demo loaded');
  });
});
