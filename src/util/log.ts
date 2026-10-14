import * as vscode from 'vscode';
import { redact } from './redact';

let channel: vscode.OutputChannel | undefined;

export function initLog(ctx: vscode.ExtensionContext): void {
  channel = vscode.window.createOutputChannel('Keycloak');
  ctx.subscriptions.push(channel);
}

export function log(msg: string): void {
  channel?.appendLine(`[${new Date().toISOString()}] ${redact(msg)}`);
}
