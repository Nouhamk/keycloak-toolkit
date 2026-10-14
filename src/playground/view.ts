import type { ClaimAnnotations, DecodedJwt, VerifyResult } from '../tokens/JwtInspector';

/** Pure HTML rendering for the Token Playground webview (no `vscode` imports). */

export interface TokenView {
  kind: 'access' | 'id' | 'refresh';
  label: string;
  raw: string;
  decoded?: DecodedJwt;
  verify?: VerifyResult;
}

export interface PlaygroundModel {
  title: string;
  subtitle?: string;
  environment?: string;
  tokens: TokenView[];
  annotations?: ClaimAnnotations;
  /** Access token `exp` (epoch seconds) for the countdown. */
  exp?: number;
  actions: { refresh: boolean; introspect: boolean; userinfo: boolean };
  result?: { title: string; data: unknown };
  error?: string;
  busy?: boolean;
}

export const ACTIONS = [
  'copy-access',
  'copy-id',
  'copy-refresh',
  'copy-bearer',
  'copy-curl',
  'refresh',
  'introspect',
  'userinfo',
] as const;
export type Action = (typeof ACTIONS)[number];

/** Validate a message coming from the webview. */
export function parseMessage(msg: unknown): Action | undefined {
  if (!msg || typeof msg !== 'object') return undefined;
  const a = (msg as { action?: unknown }).action;
  return typeof a === 'string' && (ACTIONS as readonly string[]).includes(a)
    ? (a as Action)
    : undefined;
}

export function esc(v: unknown): string {
  return String(v).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

const json = (v: unknown) => `<pre class="json">${esc(JSON.stringify(v, null, 2))}</pre>`;
const chips = (xs: string[], empty = '—') =>
  xs.length
    ? xs.map((x) => `<span class="chip">${esc(x)}</span>`).join(' ')
    : `<span class="muted">${empty}</span>`;

function verifyBadge(v?: VerifyResult): string {
  if (!v) return '';
  switch (v.status) {
    case 'valid':
      return `<span class="badge ok">✓ Signature valid</span>`;
    case 'expired':
      return `<span class="badge warn">✓ Signature valid · expired</span>`;
    case 'invalid':
      return `<span class="badge bad" title="${esc(v.reason)}">✗ Invalid signature</span>`;
    case 'unverified':
      return `<span class="badge muted" title="${esc(v.reason)}">? Not verified</span>`;
  }
}

function annotationsHtml(a: ClaimAnnotations): string {
  const clientRoles = Object.entries(a.clientRoles);
  const rows = (notes: ClaimAnnotations['standard']) =>
    notes
      .map(
        (n) =>
          `<tr><td class="claim">${esc(n.claim)}</td><td>${
            typeof n.value === 'object' ? json(n.value) : esc(n.value)
          }</td><td class="muted">${esc(n.explanation ?? '')}</td></tr>`,
      )
      .join('');
  return `
  <section>
    <h2>Access summary</h2>
    <dl>
      <dt>Authorized party (azp)</dt><dd>${a.authorizedParty ? chips([a.authorizedParty]) : chips([])}</dd>
      <dt>Audience (aud)</dt><dd>${chips(a.audience)}</dd>
      <dt>Scopes</dt><dd>${chips(a.scopes)}</dd>
      <dt>Realm roles</dt><dd>${chips(a.realmRoles)}</dd>
      <dt>Client roles</dt><dd>${
        clientRoles.length
          ? clientRoles.map(([c, r]) => `<div><b>${esc(c)}</b>: ${chips(r)}</div>`).join('')
          : chips([])
      }</dd>
      <dt>Groups</dt><dd>${chips(a.groups, 'none (add a group mapper to include groups)')}</dd>
    </dl>
  </section>
  <section>
    <h2>Claims</h2>
    <table>${rows(a.standard)}</table>
    ${a.custom.length ? `<h3>Custom claims (mappers)</h3><table>${rows(a.custom)}</table>` : ''}
  </section>`;
}

function tokenHtml(t: TokenView): string {
  const copy = `copy-${t.kind}`;
  return `
  <details ${t.kind === 'access' ? 'open' : ''}>
    <summary><b>${esc(t.label)}</b> ${verifyBadge(t.verify)}
      <button data-action="${copy}">Copy</button></summary>
    <textarea readonly rows="4">${esc(t.raw)}</textarea>
    ${
      t.decoded
        ? `<div class="cols"><div><h3>Header</h3>${json(t.decoded.header)}</div>
           <div><h3>Payload</h3>${json(t.decoded.payload)}</div></div>`
        : `<p class="muted">Not a JWT (opaque token).</p>`
    }
  </details>`;
}

export function renderPlayground(m: PlaygroundModel, nonce: string, cspSource: string): string {
  const env = m.environment
    ? `<span class="env env-${esc(m.environment)}">${esc(m.environment)}</span>`
    : '';
  const btn = (action: Action, label: string, enabled = true) =>
    `<button data-action="${action}" ${enabled && !m.busy ? '' : 'disabled'}>${label}</button>`;
  const hasAccess = m.tokens.some((t) => t.kind === 'access');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">
  body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:0 1rem 2rem}
  h1{font-size:1.3rem;margin-bottom:.2rem} h2{font-size:1.05rem;margin-top:1.5rem} h3{font-size:.95rem}
  .muted{color:var(--vscode-descriptionForeground)}
  .toolbar{display:flex;flex-wrap:wrap;gap:.4rem;margin:1rem 0;align-items:center}
  button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;padding:.3rem .7rem;cursor:pointer;border-radius:2px}
  button:hover{background:var(--vscode-button-hoverBackground)} button:disabled{opacity:.5;cursor:default}
  summary button{margin-left:.5rem;padding:.1rem .5rem}
  textarea{width:100%;font-family:var(--vscode-editor-font-family);background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);word-break:break-all}
  pre.json{background:var(--vscode-textCodeBlock-background);padding:.5rem;overflow:auto;margin:0;font-family:var(--vscode-editor-font-family)}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:1rem} @media(max-width:700px){.cols{grid-template-columns:1fr}}
  details{border:1px solid var(--vscode-panel-border);padding:.5rem;margin:.5rem 0}
  .badge{font-size:.8rem;padding:.1rem .4rem;border-radius:3px;margin-left:.4rem}
  .ok{background:var(--vscode-testing-iconPassed);color:#000}.warn{background:var(--vscode-editorWarning-foreground);color:#000}
  .bad{background:var(--vscode-errorForeground);color:#fff}
  .chip{display:inline-block;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);padding:0 .4rem;border-radius:8px;margin:.1rem}
  .env{font-size:.75rem;padding:.1rem .4rem;border-radius:3px;border:1px solid currentColor;margin-left:.5rem}
  .env-prod{color:var(--vscode-errorForeground);font-weight:bold}
  dl{display:grid;grid-template-columns:max-content 1fr;gap:.3rem 1rem} dt{font-weight:bold}
  table{border-collapse:collapse;width:100%} td{border-bottom:1px solid var(--vscode-panel-border);padding:.25rem;vertical-align:top}
  td.claim{font-family:var(--vscode-editor-font-family);white-space:nowrap}
  .error{color:var(--vscode-errorForeground);border:1px solid var(--vscode-errorForeground);padding:.5rem}
  #countdown{font-weight:bold}
</style></head>
<body>
  <h1>${esc(m.title)} ${env}</h1>
  ${m.subtitle ? `<div class="muted">${esc(m.subtitle)}</div>` : ''}
  ${m.error ? `<p class="error">${esc(m.error)}</p>` : ''}
  <div class="toolbar">
    ${m.exp !== undefined ? `<span>Expires in <span id="countdown" data-exp="${m.exp}"></span></span>` : ''}
    ${btn('refresh', 'Refresh token', m.actions.refresh)}
    ${btn('introspect', 'Introspect', m.actions.introspect)}
    ${btn('userinfo', 'Userinfo', m.actions.userinfo)}
    ${btn('copy-bearer', 'Copy as Authorization header', hasAccess)}
    ${btn('copy-curl', 'Copy as curl', hasAccess)}
    ${m.busy ? '<span class="muted">Working…</span>' : ''}
  </div>
  ${m.result ? `<section><h2>${esc(m.result.title)}</h2>${json(m.result.data)}</section>` : ''}
  <section><h2>Tokens</h2>${m.tokens.map(tokenHtml).join('')}</section>
  ${m.annotations ? annotationsHtml(m.annotations) : ''}
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.querySelectorAll('[data-action]').forEach((b) =>
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); vscode.postMessage({ action: b.dataset.action }); }));
  const cd = document.getElementById('countdown');
  if (cd) {
    const exp = Number(cd.dataset.exp);
    const tick = () => {
      const s = exp - Math.floor(Date.now() / 1000);
      if (s <= 0) { cd.textContent = 'expired'; return; }
      const m = Math.floor(s / 60), r = s % 60;
      cd.textContent = (m ? m + 'm ' : '') + r + 's';
    };
    tick(); setInterval(tick, 1000);
  }
</script>
</body></html>`;
}
