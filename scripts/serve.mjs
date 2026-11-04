#!/usr/bin/env node
// Zero-dependency static server for app/ (gzips JSON/JS/CSS). Usage: node scripts/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = fileURLToPath(new URL('../app/', import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 8000);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};
const cache = new Map();

export function start(port = PORT) {
  const server = createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (path.endsWith('/')) path += 'index.html';
      const file = normalize(join(ROOT, path));
      if (!file.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) { res.writeHead(403).end(); return; }
      const st = await stat(file);
      const type = TYPES[extname(file)] || 'application/octet-stream';
      const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '') && /json|javascript|css|html|svg/.test(type);
      const ck = `${file}:${st.mtimeMs}:${gz}`;
      let body = cache.get(ck);
      if (!body) { body = await readFile(file); if (gz) body = gzipSync(body); cache.set(ck, body); }
      res.writeHead(200, {
        'Content-Type': type, 'Cache-Control': 'no-cache', ...(gz ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}),
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  start().then((s) => console.log(`Lineup Nine running at http://localhost:${s.address().port}/`));
}
