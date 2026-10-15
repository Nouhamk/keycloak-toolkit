import * as path from 'node:path';
import * as vscode from 'vscode';
import type { AdminClientFactory } from '../connections/AdminClientFactory';
import type { ConnectionStore } from '../connections/ConnectionStore';
import type { Connection } from '../connections/types';
import { normalizeToString } from './Normalizer';
import { RealmDocumentProvider } from './RealmDocumentProvider';
import { exportRealm } from './RealmExporter';

export interface RealmRef {
  conn: Connection;
  realm: string;
}

const label = (r: RealmRef) => `${r.conn.name}/${r.realm} (${r.conn.environment})`;

export async function pickRealm(
  store: ConnectionStore,
  clients: AdminClientFactory,
  title: string,
  preferredRealm?: string,
): Promise<RealmRef | undefined> {
  const conns = store.list();
  if (!conns.length) {
    vscode.window.showInformationMessage('Add a connection first: "Keycloak: Add Connection".');
    return;
  }
  const conn =
    conns.length === 1
      ? conns[0]!
      : (
          await vscode.window.showQuickPick(
            conns.map((c) => ({ label: c.name, description: c.environment, c })),
            { title, placeHolder: 'Connection' },
          )
        )?.c;
  if (!conn) return;
  const realms = (await (await clients.get(conn.id)).listRealms()).map((r) => r.realm);
  if (preferredRealm && realms.includes(preferredRealm)) return { conn, realm: preferredRealm };
  const realm = await vscode.window.showQuickPick(realms, { title, placeHolder: 'Realm' });
  return realm ? { conn, realm } : undefined;
}

/** Export a realm (no users), normalize it and save it where the user chooses. */
export async function pullRealm(ref: RealmRef, clients: AdminClientFactory): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const fileName = `${ref.realm}.realm.json`;
  const target = await vscode.window.showSaveDialog({
    title: `Save realm "${ref.realm}"`,
    defaultUri: folder ? vscode.Uri.joinPath(folder, fileName) : undefined,
    filters: { 'Realm JSON': ['json'] },
  });
  if (!target) return;
  const text = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Exporting ${label(ref)}…` },
    async () => exportRealm(await clients.get(ref.conn.id), ref.realm),
  );
  await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(text));
  await vscode.window.showTextDocument(target);
  vscode.window.setStatusBarMessage(`Realm saved (users excluded, secrets masked).`, 5000);
}

/** Diff a local realm JSON file against the live realm. */
export async function compareWithLive(
  file: vscode.Uri | undefined,
  store: ConnectionStore,
  clients: AdminClientFactory,
): Promise<void> {
  const uri = file ?? vscode.window.activeTextEditor?.document.uri;
  if (!uri || uri.scheme !== 'file') {
    vscode.window.showInformationMessage('Open or select a realm JSON file first.');
    return;
  }
  const doc = await vscode.workspace.openTextDocument(uri);
  if (doc.isDirty) await doc.save();
  let parsed: { realm?: unknown };
  try {
    parsed = JSON.parse(doc.getText()) as { realm?: unknown };
  } catch {
    vscode.window.showErrorMessage(`${path.basename(uri.fsPath)} is not valid JSON.`);
    return;
  }
  const ref = await pickRealm(
    store,
    clients,
    'Compare with live realm',
    typeof parsed.realm === 'string' ? parsed.realm : undefined,
  );
  if (!ref) return;

  // If the file is already normalized, diff the real file so it stays editable.
  const alreadyNormalized = doc.getText().trim() === normalizeToString(parsed).trim();
  const left = alreadyNormalized ? uri : RealmDocumentProvider.normalizedUri(uri);
  if (!alreadyNormalized) {
    vscode.window.setStatusBarMessage(
      'Showing a normalized view of the file (ids removed, arrays sorted).',
      6000,
    );
  }
  const right = RealmDocumentProvider.liveUri(ref.conn.id, ref.realm, label(ref));
  await vscode.commands.executeCommand(
    'vscode.diff',
    left,
    right,
    `${path.basename(uri.fsPath)} ↔ ${label(ref)} (live)`,
  );
}

/** Diff two live realms, e.g. staging vs prod. */
export async function compareRealms(
  store: ConnectionStore,
  clients: AdminClientFactory,
  first?: RealmRef,
): Promise<void> {
  const a = first ?? (await pickRealm(store, clients, 'Compare realms: first (left)'));
  if (!a) return;
  const b = await pickRealm(store, clients, `Compare ${label(a)} with… (right)`);
  if (!b) return;
  await vscode.commands.executeCommand(
    'vscode.diff',
    RealmDocumentProvider.liveUri(a.conn.id, a.realm, label(a)),
    RealmDocumentProvider.liveUri(b.conn.id, b.realm, label(b)),
    `${label(a)} ↔ ${label(b)}`,
  );
}
