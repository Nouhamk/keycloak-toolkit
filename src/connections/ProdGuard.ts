import type { Connection } from './types';

/** Tracks which prod-tagged connections the user unlocked for writes in this session (memory only). */
export class ProdGuard {
  private readonly unlocked = new Set<string>();

  isLocked(conn: Connection): boolean {
    return conn.environment === 'prod' && !this.unlocked.has(conn.id);
  }

  unlock(id: string): void {
    this.unlocked.add(id);
  }

  lock(id: string): void {
    this.unlocked.delete(id);
  }

  /** Throws if a write is attempted on a locked prod connection. */
  assertWritable(conn: Connection): void {
    if (this.isLocked(conn)) {
      throw new Error(
        `"${conn.name}" is a production connection and is read-only. Run "Keycloak: Unlock Production Connection" to allow writes for this session.`,
      );
    }
  }
}
