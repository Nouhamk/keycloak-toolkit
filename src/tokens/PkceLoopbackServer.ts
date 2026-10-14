import { createServer, type Server } from 'node:http';

export interface LoopbackHandle {
  redirectUri: string;
  /** Resolves with the authorization code; rejects on error, state mismatch or timeout. */
  code: Promise<string>;
  close(): void;
}

const PAGE = (title: string, msg: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font-family:system-ui;padding:3rem;text-align:center"><h2>${title}</h2><p>${msg}</p></body>`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * One-shot HTTP server on 127.0.0.1 (random port) that receives the OAuth redirect.
 * Validates `state`, answers once, then closes.
 */
export async function startLoopback(
  expectedState: string,
  timeoutMs = 5 * 60_000,
): Promise<LoopbackHandle> {
  let resolve!: (code: string) => void;
  let reject!: (e: Error) => void;
  const code = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  code.catch(() => undefined); // avoid unhandled rejection if caller never awaits

  let done = false;
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/callback' || done) {
      res.writeHead(404).end();
      return;
    }
    done = true;
    const p = url.searchParams;
    const html = (status: number, title: string, msg: string) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
      res.end(PAGE(title, esc(msg)));
    };
    if (p.get('state') !== expectedState) {
      html(400, 'Login failed', 'State mismatch. Start the login again from VS Code.');
      reject(new Error('State mismatch in redirect. Possible CSRF; login aborted.'));
    } else if (p.get('error')) {
      const msg = p.get('error_description') ?? p.get('error') ?? 'unknown error';
      html(400, 'Login failed', msg);
      reject(new Error(`Login failed: ${msg}`));
    } else if (!p.get('code')) {
      html(400, 'Login failed', 'No authorization code received.');
      reject(new Error('No authorization code in redirect.'));
    } else {
      html(200, 'Signed in', 'You can close this tab and return to VS Code.');
      resolve(p.get('code')!);
    }
    close();
  });

  const timer = setTimeout(() => {
    reject(new Error('Timed out waiting for the browser login.'));
    close();
  }, timeoutMs);

  function close() {
    clearTimeout(timer);
    server.close();
    server.closeAllConnections?.();
  }

  await new Promise<void>((res, rej) => {
    server.once('error', rej);
    server.listen(0, '127.0.0.1', () => res());
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;

  return {
    redirectUri: `http://127.0.0.1:${port}/callback`,
    code,
    close: () => {
      if (!done) reject(new Error('Cancelled.'));
      done = true;
      close();
    },
  };
}
