import type { ClaimAnnotations, DecodedJwt, VerifyResult } from '../tokens/JwtInspector';
import { chips, envPill, esc, jsonHtml, jwtHtml, page } from '../webview/ui';

export { esc } from '../webview/ui';

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

function verifyStatus(v?: VerifyResult): string {
  if (!v) return '';
  switch (v.status) {
    case 'valid':
      return `<span class="status ok" title="Verified against the realm's public keys">Signature valid</span>`;
    case 'expired':
      return `<span class="status warn">Valid signature · expired</span>`;
    case 'invalid':
      return `<span class="status bad" title="${esc(v.reason)}">Invalid signature</span>`;
    case 'unverified':
      return `<span class="status neutral" title="${esc(v.reason)}">Not verified</span>`;
  }
}

function expiryRing(exp: number, iat?: number): string {
  // r=22 → circumference ≈ 138.2
  return `
  <div class="ring" id="ring" data-exp="${exp}" data-iat="${iat ?? ''}" title="Time until the access token expires">
    <svg viewBox="0 0 52 52" width="64" height="64" aria-hidden="true">
      <circle cx="26" cy="26" r="22" class="track"/>
      <circle cx="26" cy="26" r="22" class="bar" id="ring-bar" stroke-dasharray="138.2" stroke-dashoffset="0"/>
    </svg>
    <div class="ring-label"><b id="ring-text">–</b><span class="muted">left</span></div>
  </div>`;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function summaryCards(t: TokenView | undefined, a: ClaimAnnotations): string {
  const p = t?.decoded?.payload ?? {};
  const who = str(p.preferred_username) ?? str(p.client_id) ?? str(p.sub) ?? 'unknown';
  const isServiceAccount = who.startsWith('service-account-') || (!!p.client_id && !p.email);
  const clientRoles = Object.entries(a.clientRoles).filter(([, r]) => r.length);
  return `
  <div class="grid">
    <div class="card">
      <h2>Subject</h2>
      <div class="big">${esc(who)}</div>
      <div class="muted small">${isServiceAccount ? 'Service account' : esc(str(p.email) ?? 'User')}</div>
      <div class="muted small mono" title="sub">${esc(str(p.sub) ?? '')}</div>
    </div>
    <div class="card">
      <h2>Issued to (azp)</h2>
      <div class="big">${esc(a.authorizedParty ?? '—')}</div>
      <div class="muted small">Audience</div>
      <div>${chips(a.audience, 'no audience', 'outline')}</div>
    </div>
    <div class="card">
      <h2>Scopes</h2>
      <div>${chips(a.scopes, 'no scope claim', 'outline')}</div>
    </div>
  </div>
  <div class="grid">
    <div class="card">
      <h2>Realm roles</h2>
      <div>${chips(a.realmRoles, 'no realm roles')}</div>
    </div>
    <div class="card">
      <h2>Client roles</h2>
      ${
        clientRoles.length
          ? clientRoles
              .map(
                ([c, r]) =>
                  `<div class="kv"><span class="muted mono">${esc(c)}</span> ${chips(r)}</div>`,
              )
              .join('')
          : `<span class="muted">no client roles</span>`
      }
    </div>
    <div class="card">
      <h2>Groups</h2>
      <div>${chips(a.groups, 'not in token (needs a group mapper)')}</div>
    </div>
  </div>`;
}

function claimsTable(a: ClaimAnnotations): string {
  const rows = (notes: ClaimAnnotations['standard']) =>
    notes
      .map(
        (n) =>
          `<tr><td class="claim">${esc(n.claim)}</td><td class="val">${
            n.value !== null && typeof n.value === 'object' ? jsonHtml(n.value) : esc(n.value)
          }</td><td class="muted">${esc(n.explanation ?? '')}</td></tr>`,
      )
      .join('');
  return `
  <details class="card">
    <summary><b>Every claim, explained</b> <span class="muted small">(${a.standard.length + a.custom.length})</span></summary>
    <table class="claims">
      <thead><tr><th>Claim</th><th>Value</th><th>Meaning</th></tr></thead>
      <tbody>${rows(a.standard)}</tbody>
    </table>
    ${
      a.custom.length
        ? `<h2 class="custom-h">Custom claims (from mappers)</h2>
           <table class="claims"><tbody>${rows(a.custom)}</tbody></table>`
        : ''
    }
  </details>`;
}

function tokenTabs(tokens: TokenView[]): string {
  if (!tokens.length) return '';
  const tabs = tokens
    .map(
      (t, i) =>
        `<button role="tab" data-tab="${t.kind}" aria-selected="${i === 0}">${esc(t.label)}</button>`,
    )
    .join('');
  const panels = tokens
    .map(
      (t, i) => `
    <div class="tab-panel" data-panel="${t.kind}" ${i === 0 ? '' : 'hidden'}>
      <div class="row">
        <div class="legend small"><span class="jwt-h">Header</span><span class="jwt-p">Payload</span><span class="jwt-s">Signature</span></div>
        <div class="row-end">${verifyStatus(t.verify)}
          <button class="secondary" data-action="copy-${t.kind}">Copy token</button></div>
      </div>
      ${jwtHtml(t.raw)}
      ${
        t.decoded
          ? `<div class="cols">
               <div><h2>Header</h2>${jsonHtml(t.decoded.header)}</div>
               <div><h2>Payload</h2>${jsonHtml(t.decoded.payload)}</div>
             </div>`
          : `<p class="muted">Opaque token (not a JWT).</p>`
      }
      ${t.kind === 'refresh' ? `<p class="muted small">Refresh tokens are signed with a key only Keycloak knows, so they are not verified here.</p>` : ''}
    </div>`,
    )
    .join('');
  return `<section class="card"><div class="tabs" role="tablist">${tabs}</div>${panels}</section>`;
}

const CSS = `
.big{font-size:1.25em;font-weight:600;margin:2px 0;word-break:break-all}
.kv{margin:4px 0}
.row{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.row-end{display:flex;gap:8px;align-items:center}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:var(--gap);margin-top:var(--gap)}
@media(max-width:760px){.cols{grid-template-columns:1fr}}
.custom-h{margin-top:16px}
.result{margin-bottom:var(--gap)}
details.card>summary{margin:-2px 0}
details.card[open]>summary{margin-bottom:10px}
.ring{position:relative;width:64px;height:64px}
.ring svg{transform:rotate(-90deg)}
.ring circle{fill:none;stroke-width:5}
.ring .track{stroke:var(--border)}
.ring .bar{stroke:var(--ok);stroke-linecap:round;transition:stroke-dashoffset 1s linear,stroke .3s}
.ring .bar.warn{stroke:var(--warn)} .ring .bar.bad{stroke:var(--bad)}
.ring-label{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  font-size:.78em;line-height:1.1}
.ring-label b{font-size:1.15em}
.hero-side{display:flex;align-items:center;gap:14px}
.working{display:inline-flex;align-items:center;gap:6px}
.working::before{content:'';width:12px;height:12px;border-radius:50%;border:2px solid var(--border);
  border-top-color:var(--accent);animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
`;

const SCRIPT = `
  document.querySelectorAll('[role=tab]').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('[role=tab]').forEach((x) => x.setAttribute('aria-selected', String(x === t)));
    document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = p.dataset.panel !== t.dataset.tab; });
  }));
  const ring = document.getElementById('ring');
  if (ring) {
    const exp = Number(ring.dataset.exp);
    const iat = Number(ring.dataset.iat) || exp - 300;
    const bar = document.getElementById('ring-bar');
    const txt = document.getElementById('ring-text');
    const C = 138.2;
    const tick = () => {
      const left = exp - Math.floor(Date.now() / 1000);
      const frac = Math.max(0, Math.min(1, left / Math.max(1, exp - iat)));
      bar.setAttribute('stroke-dashoffset', String(C * (1 - frac)));
      bar.setAttribute('class', 'bar' + (frac < 0.15 ? ' bad' : frac < 0.5 ? ' warn' : ''));
      if (left <= 0) { txt.textContent = 'expired'; return; }
      const m = Math.floor(left / 60), s = left % 60;
      txt.textContent = m >= 60 ? Math.floor(m / 60) + 'h' : m ? m + 'm ' + String(s).padStart(2, '0') + 's' : s + 's';
    };
    tick(); setInterval(tick, 1000);
  }
`;

export function renderPlayground(m: PlaygroundModel, nonce: string, cspSource: string): string {
  const btn = (action: Action, label: string, enabled: boolean, cls = 'secondary') =>
    `<button class="${cls}" data-action="${action}" ${enabled && !m.busy ? '' : 'disabled'}>${label}</button>`;
  const access = m.tokens.find((t) => t.kind === 'access');
  const iat = access?.decoded?.payload.iat;

  const body = `
  <header class="hero">
    <div class="titles">
      <h1>${esc(m.title)} ${envPill(m.environment)}</h1>
      ${m.subtitle ? `<div class="sub muted">${esc(m.subtitle)}</div>` : ''}
    </div>
    <div class="hero-side">
      ${verifyStatus(access?.verify)}
      ${m.exp !== undefined ? expiryRing(m.exp, typeof iat === 'number' ? iat : undefined) : ''}
    </div>
  </header>

  <nav class="toolbar">
    ${btn('refresh', 'Refresh token', m.actions.refresh, '')}
    ${btn('introspect', 'Introspect', m.actions.introspect)}
    ${btn('userinfo', 'Userinfo', m.actions.userinfo)}
    <span class="sep"></span>
    ${btn('copy-bearer', 'Copy as header', !!access)}
    ${btn('copy-curl', 'Copy as curl', !!access)}
    ${m.busy ? '<span class="working muted">Working…</span>' : ''}
  </nav>

  ${m.error ? `<div class="banner error">${esc(m.error)}</div>` : ''}
  ${m.result ? `<section class="card result"><h2>${esc(m.result.title)}</h2>${jsonHtml(m.result.data)}</section>` : ''}
  ${m.annotations ? summaryCards(access, m.annotations) : ''}
  <div class="stack">
    ${tokenTabs(m.tokens)}
    ${m.annotations ? claimsTable(m.annotations) : ''}
  </div>`;

  return page({ title: m.title, nonce, cspSource, body, css: CSS, script: SCRIPT });
}
