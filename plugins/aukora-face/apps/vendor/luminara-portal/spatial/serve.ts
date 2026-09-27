// LUMINARA PORTAL — the door.
//
// The whole server, and the whole constitution: GET and HEAD only, no write
// lane can exist here even by accident, this process never writes to disk.
// It serves two directories and nothing else — /app (the rooms) and /docs
// (the Map Room's charts) — with the same path-traversal guard on both.
// The portal is fully static: every cast, journal, and draft lives in the
// visiting browser. The room is a lens onto the repository, never a pen.
//
//   bun spatial/serve.ts [port]     (default 7096)

import * as path from 'path';
import * as fs from 'fs';

const ROOT = path.resolve(import.meta.dir, '..');
const APP_DIR = path.join(ROOT, 'spatial', 'app');
const DOCS_DIR = path.join(ROOT, 'docs');
const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 7096;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

function serveStatic(dir: string, rel: string, head: boolean): Response {
  const abs = path.resolve(dir, rel);
  if (!abs.startsWith(dir + path.sep) && abs !== dir) {
    return new Response('refused', { status: 403 }); // the traversal guard
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return new Response('not found', { status: 404 });
  }
  const type = MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream';
  if (head) {
    return new Response(null, {
      headers: { 'content-type': type, 'content-length': String(fs.statSync(abs).size) },
    });
  }
  return new Response(fs.readFileSync(abs), { headers: { 'content-type': type } });
}

Bun.serve({
  port: PORT,
  fetch(req) {
    const method = req.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      // the first invariant: no write lane, not even by accident
      return new Response('GET and HEAD only', { status: 405, headers: { allow: 'GET, HEAD' } });
    }
    const head = method === 'HEAD';
    const p = decodeURIComponent(new URL(req.url).pathname);
    if (p === '/' || p === '/index.html') {
      return Response.redirect('/app/luminara-read.html', 302);
    }
    if (p.startsWith('/app/')) return serveStatic(APP_DIR, p.slice('/app/'.length), head);
    if (p.startsWith('/docs/')) return serveStatic(DOCS_DIR, p.slice('/docs/'.length), head);
    return new Response('not found', { status: 404 });
  },
});

console.log('LUMINARA PORTAL — read-only door at http://127.0.0.1:' + PORT + ' (GET/HEAD only, no write lane)');
