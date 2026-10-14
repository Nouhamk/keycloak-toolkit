import { describe, expect, it } from 'vitest';
import { ConnectionStore, normalizeBaseUrl } from '../../src/connections/ConnectionStore';
import type { Connection, KeyValueStore, SecretStore } from '../../src/connections/types';

function fakes() {
  const state = new Map<string, unknown>();
  const secrets = new Map<string, string>();
  const kv: KeyValueStore = {
    get: <T>(k: string, d: T) => (state.has(k) ? (state.get(k) as T) : d),
    update: async (k, v) => void state.set(k, v),
  };
  const ss: SecretStore = {
    get: async (k) => secrets.get(k),
    store: async (k, v) => void secrets.set(k, v),
    delete: async (k) => void secrets.delete(k),
  };
  return { state, secrets, store: new ConnectionStore(kv, ss) };
}

const conn: Connection = {
  id: 'c1',
  name: 'Local',
  baseUrl: 'http://localhost:8080/',
  authRealm: 'master',
  authMethod: 'password',
  principal: 'admin',
  environment: 'local',
};

describe('ConnectionStore', () => {
  it('keeps secrets out of global state', async () => {
    const { state, secrets, store } = fakes();
    await store.save({ ...conn, secret: 'leak' } as Connection & { secret: string }, 'hunter2');
    expect(JSON.stringify([...state.values()])).not.toContain('hunter2');
    expect(JSON.stringify([...state.values()])).not.toContain('leak');
    expect([...secrets.values()]).toEqual(['hunter2']);
    expect(await store.getSecret('c1')).toBe('hunter2');
  });

  it('normalizes the URL and replaces on re-save', async () => {
    const { store } = fakes();
    await store.save(conn, 'a');
    await store.save({ ...conn, name: 'Renamed' }, 'b');
    expect(store.list()).toHaveLength(1);
    expect(store.get('c1')?.baseUrl).toBe('http://localhost:8080');
    expect(store.get('c1')?.name).toBe('Renamed');
  });

  it('removes metadata and secret', async () => {
    const { store, secrets } = fakes();
    await store.save(conn, 'a');
    await store.remove('c1');
    expect(store.list()).toEqual([]);
    expect(secrets.size).toBe(0);
  });

  it('rejects non-http URLs', () => {
    expect(() => normalizeBaseUrl('ftp://x')).toThrow(/http/);
  });
});
