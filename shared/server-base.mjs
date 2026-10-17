// Minimal static + API server used by all three demos (no dependencies).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'SAMEORIGIN',
  'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'self'",
};

function serveFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, SECURITY_HEADERS); return res.end('not found'); }
    const ext = path.extname(file);
    res.writeHead(200, {
      ...SECURITY_HEADERS, 'content-type': TYPES[ext] || 'application/octet-stream', 'content-length': st.size,
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    fs.createReadStream(file).pipe(res);
  });
}

// routes: { 'GET /api/x': async (req, res, url) => ... }
export function startServer({ port, publicDir, sharedDir, routes }) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    const key = `${req.method} ${url.pathname}`;
    if (url.pathname === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    const handler = routes[key];
    if (handler) {
      try { await handler(req, res, url); } catch (e) {
        console.error(key, e?.message);
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal error' }));
      }
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    let rel = decodeURIComponent(url.pathname);
    let base = publicDir;
    if (rel.startsWith('/shared/')) { base = sharedDir; rel = rel.slice('/shared'.length); }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(base, rel));
    if (!file.startsWith(base)) { res.writeHead(403); return res.end(); }
    serveFile(res, file);
  });
  server.listen(port, () => console.log(`listening on :${port}`));
  return server;
}
