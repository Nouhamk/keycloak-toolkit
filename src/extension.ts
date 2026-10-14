import * as vscode from 'vscode';
import { decode } from './tokens/JwtInspector';
import { initLog, log } from './util/log';
import { redact } from './util/redact';

export function activate(ctx: vscode.ExtensionContext): void {
  initLog(ctx);

  ctx.subscriptions.push(
    vscode.commands.registerCommand('keycloak.decodeJwt', async () => {
      const editor = vscode.window.activeTextEditor;
      const selected = editor?.document.getText(editor.selection).trim();
      const token =
        selected || (await vscode.window.showInputBox({ prompt: 'Paste a JWT', password: true }));
      if (!token) return;
      try {
        const decoded = decode(token);
        const doc = await vscode.workspace.openTextDocument({
          language: 'json',
          content: JSON.stringify(decoded, null, 2),
        });
        await vscode.window.showTextDocument(doc, { preview: true });
      } catch (e) {
        const msg = redact(String(e instanceof Error ? e.message : e));
        log(`Decode failed: ${msg}`);
        vscode.window.showErrorMessage(`Not a valid JWT: ${msg}`);
      }
    }),
  );
}

export function deactivate(): void {}
