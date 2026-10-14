import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import {
  annotateClaims,
  decode,
  verify,
  verifyByIssuer,
  type DecodedJwt,
  type VerifyResult,
} from '../tokens/JwtInspector';
import {
  toCurl,
  type ClientCredentials,
  type TokenService,
  type TokenSet,
} from '../tokens/TokenService';
import { log } from '../util/log';
import { redact } from '../util/redact';
import { parseMessage, renderPlayground, type PlaygroundModel, type TokenView } from './view';

export interface TokenSession {
  title: string;
  subtitle?: string;
  environment?: string;
  /** Absent for offline decode. */
  service?: TokenService;
  creds?: ClientCredentials;
  tokens: Partial<TokenSet> & { access_token?: string };
}

const API_PLACEHOLDER = 'https://api.example.com/resource';

/** Single reusable webview showing the current token session. */
export class PlaygroundPanel {
  private static current?: PlaygroundPanel;
  private result?: PlaygroundModel['result'];
  private error?: string;
  private busy = false;

  static show(session: TokenSession): void {
    if (PlaygroundPanel.current) {
      PlaygroundPanel.current.session = session;
      PlaygroundPanel.current.result = undefined;
      PlaygroundPanel.current.error = undefined;
      PlaygroundPanel.current.panel.reveal(vscode.ViewColumn.Active);
      void PlaygroundPanel.current.render();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'keycloak.playground',
      'Token Playground',
      vscode.ViewColumn.Active,
      { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: false },
    );
    PlaygroundPanel.current = new PlaygroundPanel(panel, session);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private session: TokenSession,
  ) {
    panel.onDidDispose(() => (PlaygroundPanel.current = undefined));
    panel.webview.onDidReceiveMessage((m) => this.onMessage(m));
    void this.render();
  }

  private async onMessage(raw: unknown): Promise<void> {
    const action = parseMessage(raw);
    if (!action) return; // ignore anything not on the allowlist
    const { service, creds, tokens } = this.session;
    const access = tokens.access_token;
    try {
      switch (action) {
        case 'copy-access':
        case 'copy-id':
        case 'copy-refresh': {
          const v =
            action === 'copy-access'
              ? access
              : action === 'copy-id'
                ? tokens.id_token
                : tokens.refresh_token;
          if (v) await this.copy(v, 'Token copied.');
          return;
        }
        case 'copy-bearer':
          if (access) await this.copy(`Authorization: Bearer ${access}`, 'Header copied.');
          return;
        case 'copy-curl': {
          if (!access) return;
          const url = this.canUserinfo()
            ? (await service!.discover()).userinfo_endpoint
            : API_PLACEHOLDER;
          await this.copy(toCurl(access, url), 'curl command copied.');
          return;
        }
        case 'refresh':
          if (!service || !creds || !tokens.refresh_token) return;
          await this.run(async () => {
            const fresh = await service.refresh(creds, tokens.refresh_token!);
            this.session = { ...this.session, tokens: fresh };
            this.result = undefined;
          });
          return;
        case 'introspect':
          if (!service || !creds?.clientSecret || !access) return;
          await this.run(async () => {
            this.result = { title: 'Introspection', data: await service.introspect(creds, access) };
          });
          return;
        case 'userinfo':
          if (!service || !access) return;
          await this.run(async () => {
            this.result = { title: 'Userinfo', data: await service.userinfo(access) };
          });
          return;
      }
    } catch (e) {
      this.error = redact(e instanceof Error ? e.message : String(e));
      log(`Playground ${action}: ${this.error}`);
      await this.render();
    }
  }

  private async copy(text: string, msg: string): Promise<void> {
    await vscode.env.clipboard.writeText(text);
    vscode.window.setStatusBarMessage(msg, 3000);
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    this.busy = true;
    this.error = undefined;
    await this.render();
    try {
      await fn();
    } catch (e) {
      this.error = redact(e instanceof Error ? e.message : String(e));
      log(`Playground: ${this.error}`);
    } finally {
      this.busy = false;
      await this.render();
    }
  }

  private canUserinfo(): boolean {
    const scope = this.session.tokens.scope ?? '';
    return !!this.session.service && scope.split(' ').includes('openid');
  }

  private async render(): Promise<void> {
    const model = await this.buildModel();
    const nonce = randomBytes(16).toString('base64');
    this.panel.title = `Token: ${this.session.title}`;
    this.panel.webview.html = renderPlayground(model, nonce, this.panel.webview.cspSource);
  }

  private async buildModel(): Promise<PlaygroundModel> {
    const { tokens, service, creds } = this.session;
    let jwks: { uri: string; issuer: string } | undefined;
    if (service) {
      const d = await service.discover().catch(() => undefined);
      if (d) jwks = { uri: d.jwks_uri, issuer: d.issuer };
    }
    const check = async (raw: string): Promise<VerifyResult> =>
      jwks ? verify(raw, jwks.uri, jwks.issuer) : verifyByIssuer(raw);

    const views: TokenView[] = [];
    const add = async (kind: TokenView['kind'], label: string, raw?: string, doVerify = true) => {
      if (!raw) return;
      let decoded: DecodedJwt | undefined;
      try {
        decoded = decode(raw);
      } catch {
        /* opaque token */
      }
      // Keycloak refresh tokens are signed with a realm-internal key (not in JWKS): skip verify.
      const v = decoded && doVerify ? await check(raw) : undefined;
      views.push({ kind, label, raw, decoded, verify: v });
    };
    await add('access', 'Access token', tokens.access_token);
    await add('id', 'ID token', tokens.id_token);
    await add('refresh', 'Refresh token', tokens.refresh_token, false);

    const accessDecoded = views.find((v) => v.kind === 'access')?.decoded;
    const exp =
      typeof accessDecoded?.payload.exp === 'number' ? accessDecoded.payload.exp : undefined;
    return {
      title: this.session.title,
      subtitle: this.session.subtitle,
      environment: this.session.environment,
      tokens: views,
      annotations: accessDecoded ? annotateClaims(accessDecoded.payload) : undefined,
      exp,
      actions: {
        refresh: !!(service && creds && tokens.refresh_token),
        introspect: !!(service && creds?.clientSecret && tokens.access_token),
        userinfo: this.canUserinfo(),
      },
      result: this.result,
      error: this.error,
      busy: this.busy,
    };
  }
}
