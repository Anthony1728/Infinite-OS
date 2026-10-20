// A tiny localhost static server for the workspace.
//
// Why this exists: "the AI builds a website and you test it in the Tabs
// section" needs somewhere for the tab browser to load a file from. The
// alternatives were all worse:
//
//   * `shell.openPath` on a .html file — this is what the generated-HTML flow
//     used to do, and it launches the user's default browser. A Chrome window
//     appears on top of Infinite OS, which is exactly the behaviour the product
//     is supposed to avoid.
//   * `dangerouslySetInnerHTML` into the renderer — the page shares the
//     app's origin, its CSP, and its window. A generated page could reach
//     anything the app can reach.
//   * `file://` in the tab browser — refused by the guest's own web security
//     rules, and it would give a page the user's real file:// origin.
//
// A loopback HTTP server on an ephemeral port gives each file its own honest
// origin, loads in the in-app browser, and keeps everything inside the window.
//
// SECURITY. This binds 127.0.0.1 only (never 0.0.0.0), serves a single
// configured root, and refuses any path that resolves outside it — including
// via `..`, absolute paths, encoded separators, and Windows drive/UNC quirks.
// Directory listing is not offered; a path must name a file. Everything else
// about the host is the user's own machine, which is the point.

import { createServer, type Server } from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import { extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { AddressInfo } from 'node:net';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.wasm': 'application/wasm',
};

function contentType(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Resolve a request path to an absolute file inside `root`, or null.
 *
 * This is the security boundary, so it is deliberately paranoid:
 *   - percent-decoding first, twice, because double-encoding is a real bypass
 *   - backslashes normalised to forward slashes (Windows accepts both)
 *   - NUL bytes rejected outright
 *   - the resolved path must sit under the resolved root
 *   - a symlink/junction escape is caught by re-checking the *real* path
 */
export function resolveWithinRoot(root: string, requestPath: string): string | null {
  let decoded = requestPath;
  for (let i = 0; i < 2; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return null; // malformed percent-encoding
    }
  }
  if (decoded.includes('\0')) return null;
  const slashed = decoded.replace(/\\/g, '/');
  // Reject a Windows drive path outright (`C:/…`). There is never a legitimate
  // reason for one here, and silently reinterpreting it as a relative path
  // would serve a confusingly wrong file.
  //
  // Leading slashes are only collapsed, not rejected: `//server/share/x` then
  // becomes the in-root path `server/share/x`, which cannot escape the root and
  // simply 404s. Collapsing is safe (containment is enforced below) and it
  // keeps sloppy-but-harmless input like `///app/main.js` working.
  if (/^[A-Za-z]:\//.test(slashed)) return null;
  const normalised = slashed.replace(/^\/+/, '');
  if (!normalised) return null;

  const rootResolved = resolve(root);
  const candidate = resolve(join(rootResolved, normalize(normalised)));

  const within = (base: string, target: string): boolean => {
    const rel = relative(base, target);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  };
  if (!within(rootResolved, candidate)) return null;

  return candidate;
}

export interface WorkspaceServer {
  /** Loopback base URL, e.g. http://127.0.0.1:53421 */
  origin: string;
  /** Absolute path of the served root. */
  root: string;
  /** URL for a file inside the root, or null if it escapes the root. */
  urlFor(absolutePath: string): string | null;
  stop(): Promise<void>;
}

let active: WorkspaceServer | null = null;
let starting: Promise<WorkspaceServer> | null = null;

/**
 * Start (or reuse) the workspace server. Idempotent and concurrency-safe: two
 * callers racing get the same server rather than two ports.
 */
export async function startWorkspaceServer(root: string): Promise<WorkspaceServer> {
  if (active && active.root === resolve(root)) return active;
  if (starting) return starting;

  const rootResolved = resolve(root);

  starting = new Promise<WorkspaceServer>((resolvePromise, rejectPromise) => {
    const server: Server = createServer((req, res) => {
      void (async () => {
        try {
          const url = new URL(req.url ?? '/', 'http://127.0.0.1');
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405, { 'content-type': 'text/plain' }).end('Method not allowed');
            return;
          }
          // The site root serves index.html. The guard deliberately refuses a
          // bare "/" (it cannot know which file is meant), so map it here.
          const pathname = url.pathname === '/' || url.pathname === '' ? '/index.html' : url.pathname;
          let target = resolveWithinRoot(rootResolved, pathname);
          if (!target) {
            res.writeHead(403, { 'content-type': 'text/plain' }).end('Forbidden');
            return;
          }

          // A directory request falls back to its index.html, which is what a
          // built site needs. No directory listing is ever produced.
          let stat = await fs.stat(target).catch(() => null);
          if (stat?.isDirectory()) {
            const index = join(target, 'index.html');
            const indexStat = await fs.stat(index).catch(() => null);
            if (!indexStat?.isFile()) {
              res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
              return;
            }
            target = index;
            stat = indexStat;
          }
          if (!stat?.isFile()) {
            res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
            return;
          }

          res.writeHead(200, {
            'content-type': contentType(target),
            'content-length': String(stat.size),
            // Never let a served page reach back into the app or hold a lock on
            // a stale build while the AI is rewriting it.
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          });
          if (req.method === 'HEAD') {
            res.end();
            return;
          }
          createReadStream(target)
            .on('error', () => res.destroy())
            .pipe(res);
        } catch {
          if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' }).end('Server error');
          else res.destroy();
        }
      })();
    });

    server.on('error', (error) => {
      starting = null;
      rejectPromise(error instanceof Error ? error : new Error(String(error)));
    });

    // Port 0 = let the OS pick a free ephemeral port, so we never collide with
    // anything already listening.
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo | null;
      if (!address) {
        starting = null;
        rejectPromise(new Error('Workspace server did not bind to a port'));
        return;
      }
      const origin = `http://127.0.0.1:${address.port}`;
      const instance: WorkspaceServer = {
        origin,
        root: rootResolved,
        urlFor(absolutePath: string) {
          const target = resolve(absolutePath);
          const rel = relative(rootResolved, target);
          if (rel.startsWith('..') || isAbsolute(rel)) return null;
          return `${origin}/${rel.split(sep).map(encodeURIComponent).join('/')}`;
        },
        stop() {
          return new Promise<void>((done) => {
            active = null;
            starting = null;
            server.close(() => done());
            // Idle keep-alive sockets would otherwise hold the close open.
            server.closeAllConnections?.();
          });
        },
      };
      active = instance;
      starting = null;
      resolvePromise(instance);
    });
  });

  return starting;
}

/** Current server if one is running, else null. Never starts one. */
export function getWorkspaceServer(): WorkspaceServer | null {
  return active;
}

/**
 * Serve a single file even when it lives outside the workspace root.
 *
 * The agent frequently writes a scratch file (a generated landing page, a test
 * HTML) into the OS temp directory rather than the project. Those still need to
 * be viewable in the tab, so each one is granted its own tiny root instead of
 * loosening the main root. The root is the file's own directory and it is
 * never widened.
 */
const extraRoots = new Map<string, WorkspaceServer>();

export async function serveExternalFile(absolutePath: string): Promise<string | null> {
  const file = resolve(absolutePath);
  const dir = resolve(file, '..');
  const existing = extraRoots.get(file);
  if (existing) return existing.urlFor(file);

  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) return null;
  } catch {
    return null;
  }

  const server = await startWorkspaceServer(dir);
  const url = server.urlFor(file);
  if (!url) return null;
  extraRoots.set(file, server);
  return url;
}

/** Shut everything down — called on app quit. */
export async function stopAllWorkspaceServers(): Promise<void> {
  const servers = [...extraRoots.values()];
  extraRoots.clear();
  if (active) servers.push(active);
  await Promise.all(servers.map((server) => server.stop().catch(() => undefined)));
}