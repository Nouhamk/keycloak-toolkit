import * as vscode from 'vscode';
import type { AdminClientFactory } from '../connections/AdminClientFactory';
import type { ConnectionStore } from '../connections/ConnectionStore';
import type { ProdGuard } from '../connections/ProdGuard';
import type { Connection } from '../connections/types';
import { log } from '../util/log';
import { redact } from '../util/redact';

export type Category = 'clients' | 'users' | 'roles' | 'groups';
const CATEGORIES: { kind: Category; label: string; icon: string }[] = [
  { kind: 'clients', label: 'Clients', icon: 'symbol-interface' },
  { kind: 'users', label: 'Users', icon: 'person' },
  { kind: 'roles', label: 'Realm Roles', icon: 'shield' },
  { kind: 'groups', label: 'Groups', icon: 'organization' },
];
const PAGE = 100;

export type Node =
  | { type: 'connection'; conn: Connection }
  | { type: 'realm'; conn: Connection; realm: string }
  | { type: 'category'; conn: Connection; realm: string; kind: Category }
  | {
      type: 'item';
      conn: Connection;
      realm: string;
      kind: Category;
      id: string;
      label: string;
      description?: string;
    }
  | { type: 'message'; label: string; icon?: string };

export class ExplorerTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private filter = '';

  constructor(
    private readonly store: ConnectionStore,
    private readonly clients: AdminClientFactory,
    private readonly guard: ProdGuard,
  ) {}

  refresh(node?: Node): void {
    this.emitter.fire(node);
  }

  setFilter(text: string): void {
    this.filter = text.trim();
    void vscode.commands.executeCommand('setContext', 'keycloak.filterActive', !!this.filter);
    this.refresh();
  }

  getFilter(): string {
    return this.filter;
  }

  getTreeItem(n: Node): vscode.TreeItem {
    switch (n.type) {
      case 'connection': {
        const prod = n.conn.environment === 'prod';
        const locked = this.guard.isLocked(n.conn);
        const item = new vscode.TreeItem(n.conn.name, vscode.TreeItemCollapsibleState.Collapsed);
        item.description = `${n.conn.environment}${prod ? (locked ? ' · read-only' : ' · UNLOCKED') : ''}`;
        item.tooltip = `${n.conn.baseUrl}\nAuth: ${n.conn.authMethod} (${n.conn.principal}) @ ${n.conn.authRealm}`;
        item.iconPath = new vscode.ThemeIcon(
          prod ? 'circle-filled' : 'server',
          prod ? new vscode.ThemeColor('charts.red') : undefined,
        );
        item.contextValue = prod ? 'connection.prod' : 'connection';
        item.id = `c:${n.conn.id}`;
        return item;
      }
      case 'realm': {
        const item = new vscode.TreeItem(n.realm, vscode.TreeItemCollapsibleState.Collapsed);
        item.iconPath = new vscode.ThemeIcon('globe');
        item.contextValue = 'realm';
        item.id = `r:${n.conn.id}:${n.realm}`;
        return item;
      }
      case 'category': {
        const c = CATEGORIES.find((x) => x.kind === n.kind)!;
        const item = new vscode.TreeItem(c.label, vscode.TreeItemCollapsibleState.Collapsed);
        item.iconPath = new vscode.ThemeIcon(c.icon);
        if (this.filter) item.description = `filter: ${this.filter}`;
        item.contextValue = `category.${n.kind}`;
        item.id = `k:${n.conn.id}:${n.realm}:${n.kind}`;
        return item;
      }
      case 'item': {
        const item = new vscode.TreeItem(n.label, vscode.TreeItemCollapsibleState.None);
        item.description = n.description;
        item.iconPath = new vscode.ThemeIcon(CATEGORIES.find((x) => x.kind === n.kind)!.icon);
        item.contextValue = n.kind.slice(0, -1); // client | user | role | group
        return item;
      }
      case 'message': {
        const item = new vscode.TreeItem(n.label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon(n.icon ?? 'info');
        return item;
      }
    }
  }

  async getChildren(n?: Node): Promise<Node[]> {
    try {
      if (!n) return this.store.list().map((conn) => ({ type: 'connection', conn }));
      if (n.type === 'connection') {
        const api = await this.clients.get(n.conn.id);
        const realms = await api.listRealms();
        return realms.map((r) => ({ type: 'realm', conn: n.conn, realm: r.realm }));
      }
      if (n.type === 'realm') {
        return CATEGORIES.map((c) => ({
          type: 'category',
          conn: n.conn,
          realm: n.realm,
          kind: c.kind,
        }));
      }
      if (n.type === 'category') return await this.loadCategory(n);
      return [];
    } catch (e) {
      const msg = redact(e instanceof Error ? e.message : String(e));
      log(`Explorer: ${msg}`);
      return [{ type: 'message', label: msg, icon: 'error' }];
    }
  }

  private async loadCategory(n: Extract<Node, { type: 'category' }>): Promise<Node[]> {
    const api = await this.clients.get(n.conn.id);
    const f = this.filter || undefined;
    const base = { type: 'item' as const, conn: n.conn, realm: n.realm, kind: n.kind };
    let items: Node[];
    switch (n.kind) {
      case 'clients':
        items = (await api.listClients(n.realm, f, PAGE)).map((c) => ({
          ...base,
          id: c.id,
          label: c.clientId,
          description: c.publicClient ? 'public' : 'confidential',
        }));
        break;
      case 'users':
        items = (await api.listUsers(n.realm, f, PAGE)).map((u) => ({
          ...base,
          id: u.id,
          label: u.username,
          description: u.email,
        }));
        break;
      case 'roles':
        items = (await api.listRealmRoles(n.realm, f, PAGE)).map((r) => ({
          ...base,
          id: r.id,
          label: r.name,
          description: r.composite ? 'composite' : undefined,
        }));
        break;
      case 'groups':
        items = (await api.listGroups(n.realm, f, PAGE)).map((g) => ({
          ...base,
          id: g.id,
          label: g.name,
          description: g.subGroupCount ? `${g.subGroupCount} subgroups` : undefined,
        }));
        break;
    }
    if (items.length === 0) return [{ type: 'message', label: f ? 'No matches' : 'Empty' }];
    if (items.length >= PAGE) {
      items.push({
        type: 'message',
        label: `Showing first ${PAGE}. Use Filter to narrow.`,
        icon: 'filter',
      });
    }
    return items;
  }
}
