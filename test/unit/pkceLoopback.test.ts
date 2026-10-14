import { describe, expect, it } from 'vitest';
import { startLoopback } from '../../src/tokens/PkceLoopbackServer';

describe('PkceLoopbackServer', () => {
  it('binds to 127.0.0.1 on a random port and resolves the code once', async () => {
    const loop = await startLoopback('good');
    expect(loop.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    const res = await fetch(`${loop.redirectUri}?code=abc&state=good`);
    expect(res.status).toBe(200);
    await expect(loop.code).resolves.toBe('abc');
    await expect(fetch(`${loop.redirectUri}?code=again&state=good`)).rejects.toThrow();
  });

  it('rejects on state mismatch', async () => {
    const loop = await startLoopback('good');
    const res = await fetch(`${loop.redirectUri}?code=abc&state=evil`);
    expect(res.status).toBe(400);
    await expect(loop.code).rejects.toThrow(/State mismatch/);
  });

  it('reports errors from the authorization server', async () => {
    const loop = await startLoopback('s');
    await fetch(`${loop.redirectUri}?error=access_denied&error_description=nope&state=s`);
    await expect(loop.code).rejects.toThrow(/nope/);
  });

  it('times out', async () => {
    const loop = await startLoopback('s', 20);
    await expect(loop.code).rejects.toThrow(/Timed out/);
  });
});
