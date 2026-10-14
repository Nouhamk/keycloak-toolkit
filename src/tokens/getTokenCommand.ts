import * as vscode from 'vscode';
import type { AdminClientFactory } from '../connections/AdminClientFactory';
import type { ClientRepresentation } from '../connections/KeycloakAdminApi';
import type { ConnectionStore } from '../connections/ConnectionStore';
import type { Connection } from '../connections/types';
import { PlaygroundPanel } from '../playground/PlaygroundPanel';
import { startLoopback } from './PkceLoopbackServer';
import {
  createPkce,
  randomState,
  TokenService,
  type ClientCredentials,
  type TokenSet,
} from './TokenService';

export interface ClientTarget {
  conn: Connection;
  realm: string;
  /** Internal client UUID. */
  id: string;
}

type Flow = 'client_credentials' | 'auth_code' | 'device' | 'password';

interface FlowPick extends vscode.QuickPickItem {
  flow: Flow;
}

/** Which grants this client can use, based on its Keycloak configuration. */
export function availableFlows(c: ClientRepresentation, allowPassword: boolean): Flow[] {
  if (c.bearerOnly) return [];
  const flows: Flow[] = [];
  if (c.serviceAccountsEnabled && !c.publicClient) flows.push('client_credentials');
  if (c.standardFlowEnabled !== false) flows.push('auth_code');
  if (c.attributes?.['oauth2.device.authorization.grant.enabled'] === 'true') flows.push('device');
  if (allowPassword && c.directAccessGrantsEnabled) flows.push('password');
  return flows;
}

const FLOW_LABELS: Record<Flow, { label: string; detail: string }> = {
  client_credentials: { label: 'Client credentials', detail: 'Service account token (no user)' },
  auth_code: { label: 'Authorization code + PKCE', detail: 'Log in as a user in your browser' },
  device: { label: 'Device code', detail: 'Log in on any device with a short code' },
  password: { label: 'Password (legacy, dev only)', detail: 'Resource Owner Password grant' },
};

export async function pickClientTarget(
  store: ConnectionStore,
  clients: AdminClientFactory,
): Promise<ClientTarget | undefined> {
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
            { placeHolder: 'Connection' },
          )
        )?.c;
  if (!conn) return;
  const api = await clients.get(conn.id);
  const realms = (await api.listRealms()).map((r) => ({ label: r.realm }));
  const realm = (await vscode.window.showQuickPick(realms, { placeHolder: 'Realm' }))?.label;
  if (!realm) return;
  const items = (await api.listClients(realm, undefined, 500)).map((c) => ({
    label: c.clientId,
    description: c.publicClient ? 'public' : 'confidential',
    id: c.id,
  }));
  const client = await vscode.window.showQuickPick(items, {
    placeHolder: 'Client',
    matchOnDescription: true,
  });
  return client && { conn, realm, id: client.id };
}

export async function getToken(target: ClientTarget, clients: AdminClientFactory): Promise<void> {
  const { conn, realm } = target;
  const api = await clients.get(conn.id);
  const client = await api.getClient(realm, target.id);
  const allowPassword = vscode.workspace
    .getConfiguration('keycloak')
    .get<boolean>('tokens.allowPasswordGrant', false);

  const flows = availableFlows(client, allowPassword);
  if (!flows.length) {
    vscode.window.showWarningMessage(
      client.bearerOnly
        ? `"${client.clientId}" is bearer-only and cannot obtain tokens.`
        : `"${client.clientId}" has no grant this extension can use. Enable the standard flow, service accounts or device grant on the client.`,
    );
    return;
  }

  const flow =
    flows.length === 1
      ? flows[0]!
      : (
          await vscode.window.showQuickPick<FlowPick>(
            flows.map((f) => ({ ...FLOW_LABELS[f], flow: f })),
            { placeHolder: `Get a token for ${client.clientId}` },
          )
        )?.flow;
  if (!flow) return;

  const creds: ClientCredentials = { clientId: client.clientId };
  if (!client.publicClient) {
    if (conn.environment === 'prod') {
      const ok = await vscode.window.showWarningMessage(
        `Read the client secret of "${client.clientId}" from PRODUCTION to request a token? It stays in memory only.`,
        { modal: true },
        'Continue',
      );
      if (ok !== 'Continue') return;
    }
    creds.clientSecret = await api.getClientSecret(realm, client.id);
  }

  const service = new TokenService(conn.baseUrl, realm);
  const scope = vscode.workspace
    .getConfiguration('keycloak')
    .get<string>('tokens.scope', 'openid profile email');

  const tokens = await runFlow(flow, service, creds, scope);
  if (!tokens) return;

  PlaygroundPanel.show({
    title: `${client.clientId} @ ${realm}`,
    subtitle: `${conn.name} · ${FLOW_LABELS[flow].label}`,
    environment: conn.environment,
    service,
    creds,
    tokens,
  });
}

async function runFlow(
  flow: Flow,
  service: TokenService,
  creds: ClientCredentials,
  scope: string,
): Promise<TokenSet | undefined> {
  switch (flow) {
    case 'client_credentials':
      return vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Requesting token…' },
        () => service.clientCredentials(creds),
      );

    case 'auth_code': {
      const state = randomState();
      const pkce = createPkce();
      const loop = await startLoopback(state);
      try {
        const url = await service.authorizationUrl(creds, {
          redirectUri: loop.redirectUri,
          state,
          codeChallenge: pkce.challenge,
          scope,
        });
        await vscode.env.openExternal(vscode.Uri.parse(url));
        const code = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Waiting for browser login…',
            cancellable: true,
          },
          (_p, cancel) => {
            cancel.onCancellationRequested(() => loop.close());
            return loop.code;
          },
        );
        return await service.exchangeCode(creds, code, loop.redirectUri, pkce.verifier);
      } catch (e) {
        if (e instanceof Error && /redirect_uri/i.test(e.message)) {
          throw new Error(
            `${e.message} Add "http://127.0.0.1/*" to the client's Valid Redirect URIs.`,
          );
        }
        throw e;
      } finally {
        loop.close();
      }
    }

    case 'device': {
      const d = await service.startDeviceAuthorization(creds, scope);
      const open = d.verification_uri_complete ?? d.verification_uri;
      void vscode.window
        .showInformationMessage(
          `Device login: open ${d.verification_uri} and enter code ${d.user_code}`,
          'Open Browser',
          'Copy Code',
        )
        .then((choice) => {
          if (choice === 'Open Browser') void vscode.env.openExternal(vscode.Uri.parse(open));
          if (choice === 'Copy Code') void vscode.env.clipboard.writeText(d.user_code);
        });
      const ac = new AbortController();
      return vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Waiting for device login (code ${d.user_code})…`,
          cancellable: true,
        },
        (_p, cancel) => {
          cancel.onCancellationRequested(() => ac.abort());
          return service.pollDeviceToken(creds, d, { signal: ac.signal });
        },
      );
    }

    case 'password': {
      const username = await vscode.window.showInputBox({
        prompt: 'Username',
        ignoreFocusOut: true,
      });
      if (!username) return;
      const password = await vscode.window.showInputBox({
        prompt: `Password for ${username}`,
        password: true,
        ignoreFocusOut: true,
      });
      if (!password) return;
      return vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Requesting token…' },
        () => service.password(creds, username, password, scope),
      );
    }
  }
}
