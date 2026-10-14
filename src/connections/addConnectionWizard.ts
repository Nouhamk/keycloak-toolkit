import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { normalizeBaseUrl } from './ConnectionStore';
import { KeycloakAdminApi } from './KeycloakAdminApi';
import type { AuthMethod, Connection, EnvironmentTag } from './types';

export interface WizardResult {
  conn: Connection;
  secret: string;
  version: string;
}

/** Collects connection details, tests them, and returns them (caller persists). */
export async function runAddConnectionWizard(): Promise<WizardResult | undefined> {
  const url = await vscode.window.showInputBox({
    title: 'Add Keycloak Connection (1/6)',
    prompt: 'Keycloak base URL',
    value: 'http://localhost:8080',
    ignoreFocusOut: true,
    validateInput: (v) => {
      try {
        normalizeBaseUrl(v);
        return undefined;
      } catch (e) {
        return e instanceof Error ? e.message : 'Invalid URL';
      }
    },
  });
  if (!url) return;

  const authRealm = await vscode.window.showInputBox({
    title: 'Add Keycloak Connection (2/6)',
    prompt: 'Realm to authenticate against',
    value: 'master',
    ignoreFocusOut: true,
  });
  if (!authRealm) return;

  const method = await vscode.window.showQuickPick(
    [
      {
        label: 'Admin user',
        description: 'username + password via admin-cli',
        value: 'password' as AuthMethod,
      },
      {
        label: 'Service account',
        description: 'client_credentials',
        value: 'client_credentials' as AuthMethod,
      },
    ],
    {
      title: 'Add Keycloak Connection (3/6)',
      placeHolder: 'Authentication method',
      ignoreFocusOut: true,
    },
  );
  if (!method) return;

  const isPwd = method.value === 'password';
  const principal = await vscode.window.showInputBox({
    title: 'Add Keycloak Connection (4/6)',
    prompt: isPwd ? 'Admin username' : 'Client ID',
    value: isPwd ? 'admin' : '',
    ignoreFocusOut: true,
  });
  if (!principal) return;

  const secret = await vscode.window.showInputBox({
    title: 'Add Keycloak Connection (5/6)',
    prompt: isPwd ? 'Admin password' : 'Client secret',
    password: true,
    ignoreFocusOut: true,
  });
  if (!secret) return;

  const env = await vscode.window.showQuickPick(
    (['local', 'dev', 'staging', 'prod'] as EnvironmentTag[]).map((e) => ({
      label: e,
      description: e === 'prod' ? 'read-only by default' : undefined,
    })),
    { title: 'Add Keycloak Connection (6/6)', placeHolder: 'Environment', ignoreFocusOut: true },
  );
  if (!env) return;

  const baseUrl = normalizeBaseUrl(url);
  const name =
    (await vscode.window.showInputBox({
      title: 'Connection name',
      value: `${new URL(baseUrl).host} (${env.label})`,
      ignoreFocusOut: true,
    })) ?? baseUrl;

  const conn: Connection = {
    id: randomUUID(),
    name,
    baseUrl,
    authRealm,
    authMethod: method.value,
    principal,
    environment: env.label as EnvironmentTag,
  };

  const version = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Testing connection to ${baseUrl}…` },
    async () => {
      const api = new KeycloakAdminApi(conn, secret);
      await api.accessToken();
      return api.serverVersion().catch(() => 'unknown');
    },
  );
  return { conn, secret, version };
}
