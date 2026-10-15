/** Shared, dependency-free building blocks for the extension's webviews (no `vscode` imports). */

export function esc(v: unknown): string {
  return String(v).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/** Pretty-printed JSON with syntax colouring. All content is escaped. */
export function jsonHtml(value: unknown): string {
  const text = JSON.stringify(value, null, 2) ?? 'undefined';
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let out = '';
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out += esc(text.slice(last, m.index));
    if (m[1]) {
      out += m[2]
        ? `<span class="j-key">${esc(m[1])}</span>${esc(m[2])}`
        : `<span class="j-str">${esc(m[1])}</span>`;
    } else if (m[3]) {
      out += `<span class="j-lit">${m[3]}</span>`;
    } else {
      out += `<span class="j-num">${esc(m[4])}</span>`;
    }
    last = re.lastIndex;
  }
  return `<pre class="json">${out}${esc(text.slice(last))}</pre>`;
}

/** Raw JWT with header / payload / signature in distinct colours, like jwt.io. */
export function jwtHtml(raw: string): string {
  const parts = raw.split('.');
  if (parts.length !== 3) return `<code class="jwt">${esc(raw)}</code>`;
  const [h, p, s] = parts;
  return (
    `<code class="jwt"><span class="jwt-h">${esc(h)}</span>.` +
    `<span class="jwt-p">${esc(p)}</span>.<span class="jwt-s">${esc(s)}</span></code>`
  );
}

export function chips(xs: string[], empty = 'none', cls = ''): string {
  return xs.length
    ? xs.map((x) => `<span class="chip ${cls}">${esc(x)}</span>`).join('')
    : `<span class="muted">${esc(empty)}</span>`;
}

export function envPill(env?: string): string {
  return env ? `<span class="env env-${esc(env)}">${esc(env)}</span>` : '';
}

export function page(opts: {
  title: string;
  nonce: string;
  cspSource: string;
  body: string;
  script?: string;
  css?: string;
}): string {
  const { nonce, cspSource } = opts;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<style nonce="${nonce}">${BASE_CSS}${opts.css ?? ''}</style></head>
<body>${opts.body}
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.querySelectorAll('[data-action]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      vscode.postMessage({ action: b.dataset.action });
    }));
  ${opts.script ?? ''}
</script>
</body></html>`;
}

const BASE_CSS = `
:root{
  --gap:12px; --radius:6px;
  --ok:var(--vscode-testing-iconPassed,#3fb950);
  --bad:var(--vscode-testing-iconFailed,#f85149);
  --warn:var(--vscode-editorWarning-foreground,#d29922);
  --accent:var(--vscode-textLink-foreground);
  --card:var(--vscode-editorWidget-background,var(--vscode-sideBar-background));
  --border:var(--vscode-widget-border,var(--vscode-panel-border,rgba(128,128,128,.35)));
}
*{box-sizing:border-box}
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);
  padding:20px 24px 40px;max-width:1200px;margin:0 auto;line-height:1.45}
h1{font-size:1.5em;font-weight:600;margin:0}
h2{font-size:.8em;font-weight:600;text-transform:uppercase;letter-spacing:.08em;margin:0 0 10px;
  color:var(--vscode-descriptionForeground)}
.muted{color:var(--vscode-descriptionForeground)}
.small{font-size:.9em}
.mono{font-family:var(--vscode-editor-font-family)}

.hero{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:18px}
.hero .titles{flex:1;min-width:220px}
.hero .sub{margin-top:4px}

.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px}
.grid{display:grid;gap:var(--gap);grid-template-columns:repeat(auto-fit,minmax(240px,1fr));margin-bottom:var(--gap)}
.stack>*+*{margin-top:var(--gap)}

.toolbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 18px}
.toolbar .sep{width:1px;align-self:stretch;background:var(--border);margin:0 4px}
button{font:inherit;border:1px solid transparent;border-radius:4px;padding:5px 12px;cursor:pointer;
  background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
button:hover{background:var(--vscode-button-hoverBackground)}
button.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
button.secondary:hover{background:var(--vscode-button-secondaryHoverBackground)}
button.ghost{background:transparent;color:var(--accent);padding:2px 6px}
button.ghost:hover{background:var(--vscode-toolbar-hoverBackground)}
button:disabled{opacity:.45;cursor:default}
button:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:2px}

.chip{display:inline-block;padding:1px 9px;margin:2px 4px 2px 0;border-radius:999px;font-size:.92em;
  background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}
.chip.hl{background:var(--accent);color:var(--vscode-editor-background);font-weight:600}
.chip.outline{background:transparent;border:1px solid var(--border);color:var(--vscode-foreground)}

.env{font-size:.75em;font-weight:600;text-transform:uppercase;letter-spacing:.06em;padding:2px 8px;
  border-radius:4px;border:1px solid currentColor;color:var(--vscode-descriptionForeground)}
.env-prod{color:var(--bad);background:color-mix(in srgb,var(--bad) 12%,transparent)}
.env-staging{color:var(--warn)}
.env-local,.env-dev{color:var(--ok)}

.status{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;font-weight:600;
  border:1px solid currentColor}
.status::before{content:'';width:8px;height:8px;border-radius:50%;background:currentColor}
.status.ok{color:var(--ok);background:color-mix(in srgb,var(--ok) 12%,transparent)}
.status.bad{color:var(--bad);background:color-mix(in srgb,var(--bad) 12%,transparent)}
.status.warn{color:var(--warn);background:color-mix(in srgb,var(--warn) 12%,transparent)}
.status.neutral{color:var(--vscode-descriptionForeground)}

pre.json{margin:0;padding:12px;border-radius:var(--radius);overflow:auto;max-height:420px;
  background:var(--vscode-textCodeBlock-background);font-family:var(--vscode-editor-font-family);
  font-size:var(--vscode-editor-font-size)}
.j-key{color:var(--vscode-symbolIcon-propertyForeground,#9cdcfe)}
.j-str{color:var(--vscode-debugTokenExpression-string,#ce9178)}
.j-num{color:var(--vscode-debugTokenExpression-number,#b5cea8)}
.j-lit{color:var(--vscode-debugTokenExpression-boolean,#569cd6)}

code.jwt{display:block;word-break:break-all;padding:12px;border-radius:var(--radius);
  background:var(--vscode-textCodeBlock-background);font-family:var(--vscode-editor-font-family);
  font-size:var(--vscode-editor-font-size);max-height:160px;overflow:auto}
.jwt-h{color:var(--vscode-charts-red,#f14c4c)}
.jwt-p{color:var(--vscode-charts-purple,#b180d7)}
.jwt-s{color:var(--vscode-charts-blue,#3794ff)}
.legend span{margin-right:14px}
.legend span::before{content:'';display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;background:currentColor}

.tabs{display:flex;gap:2px;border-bottom:1px solid var(--border);margin-bottom:12px}
.tabs button{background:transparent;color:var(--vscode-descriptionForeground);border-radius:0;
  border-bottom:2px solid transparent;padding:6px 12px}
.tabs button[aria-selected=true]{color:var(--vscode-foreground);border-bottom-color:var(--accent)}
.tab-panel[hidden]{display:none}

table{border-collapse:collapse;width:100%}
th{text-align:left;font-weight:600;color:var(--vscode-descriptionForeground);font-size:.85em;padding:6px 8px;
  border-bottom:1px solid var(--border)}
td{padding:6px 8px;border-bottom:1px solid var(--border);vertical-align:top}
td.claim{font-family:var(--vscode-editor-font-family);white-space:nowrap;color:var(--vscode-symbolIcon-propertyForeground,inherit)}
td.val{font-family:var(--vscode-editor-font-family);word-break:break-all}
td.val pre.json{max-height:160px;padding:6px}

details>summary{cursor:pointer;list-style:none}
details>summary::-webkit-details-marker{display:none}
details>summary::before{content:'▸';display:inline-block;width:1em;transition:transform .15s}
details[open]>summary::before{transform:rotate(90deg)}

.banner{padding:10px 14px;border-radius:var(--radius);margin-bottom:var(--gap);border-left:3px solid}
.banner.error{border-color:var(--bad);background:color-mix(in srgb,var(--bad) 10%,transparent)}
.banner.info{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 8%,transparent)}
`;
