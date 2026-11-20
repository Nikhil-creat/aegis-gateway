/** Minimal static server with clean-URL and 404.html behaviour that matches Vercel's. Usage: node scripts/serve.mjs dist [port] */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const dir = resolve(process.argv[2] || 'dist');
const port = Number(process.argv[3] || process.env.PORT || 4173);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json' };

export const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = normalize(join(dir, url));
  if (!file.startsWith(dir)) { res.writeHead(403).end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!url.endsWith('/')) { res.writeHead(308, { Location: url + '/' }).end(); return; }
    file = join(file, 'index.html');
  }
  let status = 200;
  if (!existsSync(file)) { file = join(dir, '404.html'); status = 404; }
  res.writeHead(status, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(readFileSync(file));
});
if (import.meta.url === `file://${process.argv[1]}`) server.listen(port, () => console.log(`serving ${dir} at http://localhost:${port}`));
