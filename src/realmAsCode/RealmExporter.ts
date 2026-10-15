import type { KeycloakAdminApi } from '../connections/KeycloakAdminApi';
import { normalizeToString } from './Normalizer';

/** Exports a realm from the server (without users) and returns normalized JSON text. */
export async function exportRealm(api: KeycloakAdminApi, realm: string): Promise<string> {
  return normalizeToString(await api.partialExport(realm));
}
