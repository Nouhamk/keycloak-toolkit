import * as vscode from 'vscode';
import { AdminClientFactory } from './connections/AdminClientFactory';
import { runAddConnectionWizard } from './connections/addConnectionWizard';
import { ConnectionStore } from './connections/ConnectionStore';
import { ProdGuard } from './connections/ProdGuard';
import { PlaygroundPanel } from './playground/PlaygroundPanel';
import { getToken, pickClientTarget } from './tokens/getTokenCommand';
import { decode, stripBearer } from './tokens/JwtInspector';
import { initLog, log } from './util/log';
import { redact } from './util/redact';
import { ExplorerTreeProvider, type Node } from './views/ExplorerTreeProvider';

function errMsg(e: unknown): string {
  return redact(e instanceof Error ? e.message : String(e));
}

export function activate(ctx: vscode.ExtensionContext): void {
  initLog(ctx);

  const store = new ConnectionStore(ctx.globalState, ctx.secrets);
  const clients = new AdminClientFactory(store);
  const guard = new ProdGuard();
  const tree = new ExplorerTreeProvider(store, clients, guard);

  const pickConnection = async (node?: Node) => {
    if (node && node.type === 'connection') return node.conn;
    const items = store.list().map((c) => ({ label: c.name, description: c.environment, conn: c }));
    if (items.length === 0) {
      vscode.window.showInformationMessage(
        'No Keycloak connections yet. Run "Keycloak: Add Connection".',
      );
      return;
    }
    return (await vscode.window.showQuickPick(items, { placeHolder: 'Select a connection' }))?.conn;
  };

  ctx.subscriptions.push(
    vscode.window.registerTreeDataProvider('keycloak.explorer', tree),

    vscode.commands.registerCommand('keycloak.addConnection', async () => {
      try {
        const result = await runAddConnectionWizard();
        if (!result) return;
        await store.save(result.conn, result.secret);
        log(
          `Added connection "${result.conn.name}" (${result.conn.baseUrl}, Keycloak ${result.version})`,
        );
        tree.refresh();
        vscode.window.showInformationMessage(
          `Connected to Keycloak ${result.version} at ${result.conn.baseUrl}.`,
        );
      } catch (e) {
        log(`Add connection failed: ${errMsg(e)}`);
        vscode.window.showErrorMessage(`Connection test failed: ${errMsg(e)} Nothing was saved.`);
      }
    }),

    vscode.commands.registerCommand('keycloak.removeConnection', async (node?: Node) => {
      const conn = await pickConnection(node);
      if (!conn) return;
      const ok = await vscode.window.showWarningMessage(
        `Remove connection "${conn.name}" and its stored secret?`,
        { modal: true },
        'Remove',
      );
      if (ok !== 'Remove') return;
      await store.remove(conn.id);
      clients.invalidate(conn.id);
      guard.lock(conn.id);
      tree.refresh();
    }),

    vscode.commands.registerCommand('keycloak.refresh', (node?: Node) => {
      if (!node || node.type === 'connection') clients.invalidate(node?.conn.id);
      tree.refresh(node);
    }),

    vscode.commands.registerCommand('keycloak.filter', async () => {
      const text = await vscode.window.showInputBox({
        prompt: 'Filter clients, users, roles and groups (empty to clear)',
        value: tree.getFilter(),
      });
      if (text !== undefined) tree.setFilter(text);
    }),

    vscode.commands.registerCommand('keycloak.clearFilter', () => tree.setFilter('')),

    vscode.commands.registerCommand('keycloak.unlockProd', async (node?: Node) => {
      const conn = await pickConnection(node);
      if (!conn || conn.environment !== 'prod') return;
      const ok = await vscode.window.showWarningMessage(
        `Allow write actions on PRODUCTION "${conn.name}" until VS Code restarts?`,
        { modal: true },
        'Unlock',
      );
      if (ok !== 'Unlock') return;
      guard.unlock(conn.id);
      log(`Production connection "${conn.name}" unlocked for this session`);
      tree.refresh();
    }),

    vscode.commands.registerCommand('keycloak.lockProd', async (node?: Node) => {
      const conn = await pickConnection(node);
      if (!conn) return;
      guard.lock(conn.id);
      tree.refresh();
    }),

    vscode.commands.registerCommand('keycloak.getToken', async (node?: Node) => {
      try {
        const target =
          node?.type === 'item' && node.kind === 'clients'
            ? { conn: node.conn, realm: node.realm, id: node.id }
            : await pickClientTarget(store, clients);
        if (target) await getToken(target, clients);
      } catch (e) {
        log(`Get token failed: ${errMsg(e)}`);
        vscode.window.showErrorMessage(errMsg(e));
      }
    }),

    vscode.commands.registerCommand('keycloak.decodeJwt', async () => {
      const editor = vscode.window.activeTextEditor;
      const selected = editor?.document.getText(editor.selection).trim();
      const input =
        selected || (await vscode.window.showInputBox({ prompt: 'Paste a JWT', password: true }));
      if (!input) return;
      const token = stripBearer(input);
      try {
        const { payload } = decode(token);
        PlaygroundPanel.show({
          title: typeof payload.azp === 'string' ? payload.azp : 'Decoded JWT',
          subtitle: typeof payload.iss === 'string' ? payload.iss : 'Offline decode',
          tokens: { access_token: token },
        });
      } catch (e) {
        log(`Decode failed: ${errMsg(e)}`);
        vscode.window.showErrorMessage(`Not a valid JWT: ${errMsg(e)}`);
      }
    }),
  );
}

export function deactivate(): void {}
