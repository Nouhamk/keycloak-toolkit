export type EnvironmentTag = 'local' | 'dev' | 'staging' | 'prod';
export type AuthMethod = 'password' | 'client_credentials';

/** Non-secret connection metadata. Safe to persist in globalState. */
export interface Connection {
  id: string;
  name: string;
  baseUrl: string;
  /** Realm used to authenticate the admin (usually `master`). */
  authRealm: string;
  authMethod: AuthMethod;
  /** Username (password method) or client id (client_credentials method). */
  principal: string;
  environment: EnvironmentTag;
}

/** Stored only in SecretStorage. */
export interface ConnectionSecret {
  /** Admin password or client secret. */
  secret: string;
}

/** Minimal shapes of the VS Code storage APIs, so services stay `vscode`-free. */
export interface KeyValueStore {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): PromiseLike<void>;
}

export interface SecretStore {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}
