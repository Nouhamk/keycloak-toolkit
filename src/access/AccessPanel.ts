import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { AdminClientFactory } from '../connections/AdminClientFactory';
import type { ClientSummary, KeycloakAdminApi } from '../connections/KeycloakAdminApi';
import type { Connection } from '../connections/types';
import { log } from '../util/log';
import { redact } from '../util/redact';
import { explainRole, tokenHasRole, type Role } from './AccessExplainer';
import { adminAccessSource } from './adminAccessSource';
import { parseAccessMessage, renderAccess, type AccessModel } from './view';

export interface AccessQuery {
  conn: Connection;
  realm: string;
  user?: { id: string; username: string };
  client?: { id: string; clientId: string };
  role?: Role;
}

type Complete = Required<AccessQuery>;

/** Internal Keycloak clients that are rarely the "application" a developer means. */
const BUILT_IN = new Set([
  'account',
  'account-console',
  'admin-cli',
  'broker',
  'realm-management',
  'security-admin-console',
]);

async function pickUser(api: KeycloakAdminApi, realm: string) {
  const users = await api.listUsers(realm, undefined, 500);
  const pick = await vscode.window.showQuickPick(
    users.map((u) => ({ label: u.username, description: u.email, id: u.id })),
    { title: 'Explain access (1/3)', placeHolder: 'Which user?', matchOnDescription: true },
  );
  return pick && { id: pick.id, username: pick.label };
}

async function pickClient(api: KeycloakAdminApi, realm: string) {
  const all = await api.listClients(realm, undefined, 500);
  const item = (c: ClientSummary) => ({
    label: c.clientId,
    description: c.publicClient ? 'public' : 'confidential',
    id: c.id,
  });
  const own = all.filter((c) => !BUILT_IN.has(c.clientId)).map(item);
  const builtIn = all.filter((c) => BUILT_IN.has(c.clientId)).map(item);
  const pick = await vscode.window.showQuickPick(
    [...own, { label: 'Built-in', kind: vscode.QuickPickItemKind.Separator, id: '' }, ...builtIn],
    {
      title: 'Explain access (2/3)',
      placeHolder: 'Which application is the user trying to access? (used for the token check)',
    },
  );
  return pick && pick.id ? { id: pick.id, clientId: pick.label } : undefined;
}

async function pickRole(
  api: KeycloakAdminApi,
  realm: string,
  client: { id: string; clientId: string },
): Promise<Role | undefined> {
  const [clientRoles, realmRoles] = await Promise.all([
    api.listClientRoles(realm, client.id),
    api.listRealmRoles(realm, undefined, 500),
  ]);
  type Item = vscode.QuickPickItem & { role?: Role };
  const items: Item[] = [];
  if (clientRoles.length) {
    items.push({ label: `${client.clientId} roles`, kind: vscode.QuickPickItemKind.Separator });
    for (const r of clientRoles) {
      items.push({
        label: r.name,
        description: r.description,
        detail: undefined,
        role: { ...r, clientRole: true, containerId: client.id, clientId: client.clientId },
      });
    }
  }
  items.push({ label: 'Realm roles', kind: vscode.QuickPickItemKind.Separator });
  for (const r of realmRoles) {
    items.push({
      label: r.name,
      description: r.composite ? 'composite' : r.description,
      role: { ...r, clientRole: false },
    });
  }
  const pick = await vscode.window.showQuickPick(items, {
    title: 'Explain access (3/3)',
    placeHolder: 'Which role should the user have?',
    matchOnDescription: true,
  });
  return pick?.role;
}

/** Fills in whatever is missing from the query by asking the user. */
async function complete(q: AccessQuery, api: KeycloakAdminApi): Promise<Complete | undefined> {
  const user = q.user ?? (await pickUser(api, q.realm));
  if (!user) return;
  const client = q.client ?? (await pickClient(api, q.realm));
  if (!client) return;
  const role = q.role ?? (await pickRole(api, q.realm, client));
  if (!role) return;
  return { ...q, user, client, role };
}

async function compute(q: Complete, api: KeycloakAdminApi): Promise<AccessModel> {
  const explanation = await explainRole(adminAccessSource(api, q.realm), q.user, q.role);
  const [payload, clientRep, groups] = await Promise.all([
    api.exampleAccessToken(q.realm, q.client.id, q.user.id).catch((e: unknown) => {
      log(`Example token failed: ${redact(String(e))}`);
      return undefined;
    }),
    api.getClient(q.realm, q.client.id),
    explanation.has
      ? Promise.resolve(undefined)
      : api
          .getRoleGroups(q.realm, q.role.name, q.role.clientRole ? q.role.containerId : undefined)
          .catch(() => undefined),
  ]);
  return {
    realm: q.realm,
    connection: q.conn.name,
    environment: q.conn.environment,
    explanation,
    token: payload && {
      client: q.client.clientId,
      contains: tokenHasRole(payload, explanation.target),
      fullScopeAllowed: clientRep.fullScopeAllowed,
      payload,
    },
    grantingGroups: groups?.map((g) => g.path ?? g.name),
  };
}

export class AccessPanel {
  private static current?: AccessPanel;

  static async open(query: AccessQuery, clients: AdminClientFactory): Promise<void> {
    const api = await clients.get(query.conn.id);
    const q = await complete(query, api);
    if (!q) return;
    const model = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'Explaining access…' },
      () => compute(q, api),
    );
    if (AccessPanel.current) {
      AccessPanel.current.update(q, model);
      AccessPanel.current.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'keycloak.access',
      'Explain access',
      vscode.ViewColumn.Active,
      { enableScripts: true, localResourceRoots: [] },
    );
    AccessPanel.current = new AccessPanel(panel, clients, q, model);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly clients: AdminClientFactory,
    private query: Complete,
    model: AccessModel,
  ) {
    panel.onDidDispose(() => (AccessPanel.current = undefined));
    panel.webview.onDidReceiveMessage((m) => void this.onMessage(m));
    this.update(query, model);
  }

  private update(q: Complete, model: AccessModel): void {
    this.query = q;
    this.panel.title = `Access: ${q.user.username} → ${q.role.name}`;
    const nonce = randomBytes(16).toString('base64');
    this.panel.webview.html = renderAccess(model, nonce, this.panel.webview.cspSource);
  }

  private async onMessage(raw: unknown): Promise<void> {
    const action = parseAccessMessage(raw);
    if (!action) return;
    const { conn, realm, user, client } = this.query;
    const next: AccessQuery =
      action === 'rerun'
        ? this.query
        : action === 'other-role'
          ? { conn, realm, user, client }
          : { conn, realm, client, role: this.query.role };
    try {
      await AccessPanel.open(next, this.clients);
    } catch (e) {
      const msg = redact(e instanceof Error ? e.message : String(e));
      log(`Explain access: ${msg}`);
      vscode.window.showErrorMessage(`Explain access failed: ${msg}`);
    }
  }
}
