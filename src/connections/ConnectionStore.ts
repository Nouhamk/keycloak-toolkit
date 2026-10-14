import type { Connection, KeyValueStore, SecretStore } from './types';

const KEY = 'keycloak.connections';
const secretKey = (id: string) => `keycloak.connection.${id}.secret`;

export class ConnectionStore {
  constructor(
    private readonly state: KeyValueStore,
    private readonly secrets: SecretStore,
  ) {}

  list(): Connection[] {
    return this.state.get<Connection[]>(KEY, []);
  }

  get(id: string): Connection | undefined {
    return this.list().find((c) => c.id === id);
  }

  async save(conn: Connection, secret: string): Promise<void> {
    // Copy only known, non-secret fields so nothing sensitive leaks into globalState.
    const meta: Connection = {
      id: conn.id,
      name: conn.name,
      baseUrl: normalizeBaseUrl(conn.baseUrl),
      authRealm: conn.authRealm,
      authMethod: conn.authMethod,
      principal: conn.principal,
      environment: conn.environment,
    };
    const others = this.list().filter((c) => c.id !== conn.id);
    await this.secrets.store(secretKey(conn.id), secret);
    await this.state.update(KEY, [...others, meta]);
  }

  async getSecret(id: string): Promise<string | undefined> {
    return this.secrets.get(secretKey(id));
  }

  async remove(id: string): Promise<void> {
    await this.state.update(
      KEY,
      this.list().filter((c) => c.id !== id),
    );
    await this.secrets.delete(secretKey(id));
  }
}

export function normalizeBaseUrl(url: string): string {
  const u = new URL(url.trim());
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('URL must start with http:// or https://');
  }
  return u.toString().replace(/\/+$/, '');
}
