import * as vscode from 'vscode';
import type { AdminClientFactory } from '../connections/AdminClientFactory';
import { normalizeToString } from './Normalizer';
import { exportRealm } from './RealmExporter';

export const SCHEME = 'keycloak';

/**
 * Read-only virtual documents:
 *   keycloak://live/<connectionId>/<realm>.json   normalized live export
 *   keycloak://normalized/<file path>             normalized view of a local file
 */
export class RealmDocumentProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly clients: AdminClientFactory) {}

  static liveUri(connectionId: string, realm: string, label: string): vscode.Uri {
    return vscode.Uri.from({
      scheme: SCHEME,
      authority: 'live',
      path: `/${connectionId}/${encodeURIComponent(realm)}.json`,
      // Unique query so each compare fetches fresh data; label is shown in the tab.
      query: new URLSearchParams({ label, t: String(Date.now()) }).toString(),
    });
  }

  static normalizedUri(file: vscode.Uri): vscode.Uri {
    return vscode.Uri.from({
      scheme: SCHEME,
      authority: 'normalized',
      path: file.path,
      query: new URLSearchParams({ t: String(Date.now()) }).toString(),
    });
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    if (uri.authority === 'live') {
      const [, connId, file] = uri.path.split('/');
      const realm = decodeURIComponent((file ?? '').replace(/\.json$/, ''));
      const api = await this.clients.get(connId ?? '');
      return exportRealm(api, realm);
    }
    if (uri.authority === 'normalized') {
      const bytes = await vscode.workspace.fs.readFile(
        uri.with({ scheme: 'file', authority: '', query: '' }),
      );
      return normalizeToString(JSON.parse(new TextDecoder().decode(bytes)));
    }
    throw new Error(`Unknown keycloak document: ${uri.toString()}`);
  }
}
