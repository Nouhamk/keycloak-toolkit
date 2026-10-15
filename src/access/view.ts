import { chips, envPill, esc, jsonHtml, page } from '../webview/ui';
import { roleKey, summarize, type Explanation, type Hop } from './AccessExplainer';

/** Pure HTML rendering for the Explain Access webview. */

export interface AccessModel {
  realm: string;
  connection: string;
  environment?: string;
  explanation: Explanation;
  token?: {
    client: string;
    contains: boolean;
    fullScopeAllowed?: boolean;
    payload: Record<string, unknown>;
  };
  /** When the user lacks the role: groups that grant it directly. */
  grantingGroups?: string[];
  error?: string;
}

export const ACCESS_ACTIONS = ['rerun', 'other-role', 'other-user'] as const;
export type AccessAction = (typeof ACCESS_ACTIONS)[number];

export function parseAccessMessage(msg: unknown): AccessAction | undefined {
  if (!msg || typeof msg !== 'object') return undefined;
  const a = (msg as { action?: unknown }).action;
  return typeof a === 'string' && (ACCESS_ACTIONS as readonly string[]).includes(a)
    ? (a as AccessAction)
    : undefined;
}

const roleText = (name: string, client?: string) =>
  client ? `<span class="muted">${esc(client)} ›</span> ${esc(name)}` : esc(name);

function node(h: Hop, isTarget: boolean): string {
  switch (h.kind) {
    case 'user':
      return `<div class="node user"><span class="kind">User</span><b>${esc(h.name)}</b></div>`;
    case 'group':
      return `<div class="node group"><span class="kind">${h.via === 'member' ? 'Group' : 'Parent group'}</span><b>${esc(h.path)}</b></div>`;
    case 'role':
      return `<div class="node role${isTarget ? ' target' : ''}"><span class="kind">${
        h.client ? 'Client role' : 'Realm role'
      }</span><b>${roleText(h.name, h.client)}</b></div>`;
  }
}

function edge(next: Hop): string {
  const text =
    next.kind === 'group'
      ? next.via === 'member'
        ? 'member of'
        : 'inherits from'
      : next.kind === 'role'
        ? next.via === 'composite'
          ? 'includes'
          : next.via === 'direct'
            ? 'assigned'
            : 'grants'
        : '';
  return `<div class="edge"><span>${text}</span></div>`;
}

function pathHtml(path: Hop[], i: number): string {
  const parts: string[] = [];
  path.forEach((h, idx) => {
    if (idx > 0) parts.push(edge(h));
    parts.push(node(h, idx === path.length - 1));
  });
  return `<div class="path"><span class="path-n muted">${i + 1}</span><div class="flow">${parts.join('')}</div></div>`;
}

const CSS = `
.verdict{display:flex;gap:16px;align-items:flex-start;padding:18px 20px;border-radius:var(--radius);
  border:1px solid var(--border);margin-bottom:var(--gap)}
.verdict .icon{flex:none;width:40px;height:40px;border-radius:50%;display:grid;place-items:center;
  font-size:22px;font-weight:700;color:var(--vscode-editor-background)}
.verdict.ok{border-color:var(--ok);background:color-mix(in srgb,var(--ok) 9%,transparent)}
.verdict.ok .icon{background:var(--ok)}
.verdict.bad{border-color:var(--bad);background:color-mix(in srgb,var(--bad) 9%,transparent)}
.verdict.bad .icon{background:var(--bad)}
.verdict.warn{border-color:var(--warn);background:color-mix(in srgb,var(--warn) 9%,transparent)}
.verdict.warn .icon{background:var(--warn)}
.verdict h1{font-size:1.25em;margin-bottom:4px}
.verdict p{margin:0}
.checks{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}

.path{display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px dashed var(--border)}
.path:last-child{border-bottom:none}
.path-n{flex:none;width:1.4em;text-align:right;font-variant-numeric:tabular-nums}
.flow{display:flex;align-items:center;flex-wrap:wrap;gap:4px}
.node{display:flex;flex-direction:column;padding:6px 12px;border-radius:var(--radius);border:1px solid var(--border);
  background:var(--vscode-editor-background);min-width:90px}
.node .kind{font-size:.72em;text-transform:uppercase;letter-spacing:.06em;color:var(--vscode-descriptionForeground)}
.node.user{border-color:var(--vscode-charts-blue,#3794ff)}
.node.group{border-color:var(--vscode-charts-purple,#b180d7)}
.node.role{border-color:var(--vscode-charts-orange,#d18616)}
.node.target{border-width:2px;border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 18%,transparent)}
.edge{display:flex;align-items:center;color:var(--vscode-descriptionForeground);font-size:.8em;padding:0 2px}
.edge span{position:relative;padding:0 18px 0 6px;white-space:nowrap}
.edge span::after{content:'→';position:absolute;right:2px;font-size:1.2em;top:-3px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:var(--gap)}
@media(max-width:820px){.two{grid-template-columns:1fr}}
.hint{margin-top:8px}
.paths{margin-bottom:var(--gap)}
`;

export function renderAccess(m: AccessModel, nonce: string, cspSource: string): string {
  const e = m.explanation;
  const t = m.token;
  const level = !e.has ? 'bad' : t && !t.contains ? 'warn' : 'ok';
  const icon = level === 'ok' ? '✓' : level === 'bad' ? '✕' : '!';
  const target = roleText(e.target.name, e.target.client);
  const headline =
    level === 'ok'
      ? `${esc(e.user)} has ${target}`
      : level === 'bad'
        ? `${esc(e.user)} does not have ${target}`
        : `${esc(e.user)} has ${target}, but not in the token`;

  const check = (ok: boolean | undefined, label: string) =>
    ok === undefined ? '' : `<span class="status ${ok ? 'ok' : 'bad'}">${esc(label)}</span>`;

  const targetKey = roleKey(e.target);
  const effectiveChips = e.effective.length
    ? e.effective
        .map(
          (r) =>
            `<span class="chip ${roleKey(r) === targetKey ? 'hl' : ''}">${roleText(r.name, r.client)}</span>`,
        )
        .join('')
    : '<span class="muted">no roles</span>';

  const body = `
  <header class="hero">
    <div class="titles">
      <h1>Explain access ${envPill(m.environment)}</h1>
      <div class="sub muted">${esc(m.connection)} · realm ${esc(m.realm)}</div>
    </div>
    <nav class="toolbar">
      <button class="secondary" data-action="other-role">Another role</button>
      <button class="secondary" data-action="other-user">Another user</button>
      <button data-action="rerun">Re-check</button>
    </nav>
  </header>

  ${m.error ? `<div class="banner error">${esc(m.error)}</div>` : ''}

  <section class="verdict ${level}">
    <div class="icon" aria-hidden="true">${icon}</div>
    <div>
      <h1>${headline}</h1>
      <p class="muted">${esc(summarize(e, t))}</p>
      <div class="checks">
        ${check(e.has, e.has ? 'Role granted' : 'Role not granted')}
        ${t ? check(t.contains, t.contains ? `In token for ${t.client}` : `Missing from token for ${t.client}`) : ''}
      </div>
      ${
        !e.has && m.grantingGroups?.length
          ? `<p class="hint">Groups that grant it: ${chips(m.grantingGroups, '', 'outline')}</p>`
          : !e.has
            ? `<p class="hint muted">No group grants this role directly. Assign it to the user, add it to a group, or include it in a composite role the user has.</p>`
            : ''
      }
    </div>
  </section>

  ${
    e.paths.length
      ? `<section class="card paths">
           <h2>How the role is granted (${e.paths.length} ${e.paths.length === 1 ? 'path' : 'paths'})</h2>
           ${e.paths.map(pathHtml).join('')}
         </section>`
      : ''
  }

  <div class="two">
    <section class="card">
      <h2>Effective roles of ${esc(e.user)} (${e.effective.length})</h2>
      <div>${effectiveChips}</div>
    </section>
    ${
      t
        ? `<section class="card">
             <h2>Access token preview for ${esc(t.client)}</h2>
             <p class="muted small">What Keycloak would put in ${esc(e.user)}'s token. Nothing is issued.</p>
             ${jsonHtml(t.payload)}
           </section>`
        : ''
    }
  </div>`;

  return page({ title: 'Explain access', nonce, cspSource, body, css: CSS });
}
