import type { ConnectionStore } from './ConnectionStore';
import { KeycloakAdminApi, type AdminApiOptions } from './KeycloakAdminApi';

/** One cached, authenticated admin client per connection. */
export class AdminClientFactory {
  private readonly cache = new Map<string, KeycloakAdminApi>();

  constructor(
    private readonly store: ConnectionStore,
    private readonly opts: AdminApiOptions = {},
  ) {}

  async get(connectionId: string): Promise<KeycloakAdminApi> {
    const cached = this.cache.get(connectionId);
    if (cached) return cached;
    const conn = this.store.get(connectionId);
    if (!conn) throw new Error('Connection not found. It may have been removed.');
    const secret = await this.store.getSecret(connectionId);
    if (secret === undefined) {
      throw new Error(`No stored secret for "${conn.name}". Remove and re-add the connection.`);
    }
    const api = new KeycloakAdminApi(conn, secret, this.opts);
    this.cache.set(connectionId, api);
    return api;
  }

  invalidate(connectionId?: string): void {
    if (connectionId) this.cache.delete(connectionId);
    else this.cache.clear();
  }
}
