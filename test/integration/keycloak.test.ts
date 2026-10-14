import { describe, expect, it } from 'vitest';
import { decode } from '../../src/tokens/JwtInspector';

const BASE = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';

describe('demo realm (docker compose)', () => {
  it('issues a client_credentials token for the confidential client', async () => {
    const res = await fetch(`${BASE}/realms/demo/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: 'reports-backend',
        client_secret: 'dev-only-secret',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { access_token: string };
    const d = decode(body.access_token);
    expect(d.payload.iss).toBe(`${BASE}/realms/demo`);
    expect(d.payload.azp).toBe('reports-backend');
  });
});
