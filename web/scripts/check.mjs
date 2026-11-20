/** Post-build audit of dist/: SEO, structure, bundle budgets, no source maps. Exits non-zero on any failure. */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

const tmp = join(root, '.build-check.mjs');
await build({ entryPoints: [join(root, 'site.config.ts')], outfile: tmp, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent', define: { 'process.env.SITE_URL': JSON.stringify(process.env.SITE_URL || '') } });
const { ROUTES, SITE } = await import(pathToFileURL(tmp).href);
import('node:fs').then((fs) => fs.rmSync(tmp, { force: true }));

const files = walk(dist);
ok(!files.some((f) => f.endsWith('.map')), 'source map files present');
const js = files.filter((f) => f.endsWith('.js'));
for (const f of js) ok(!/sourceMappingURL/.test(readFileSync(f, 'utf8')), `sourceMappingURL in ${f}`);

const titles = new Set();
const gz = (f) => gzipSync(readFileSync(f)).length;
const BUDGET_KB = 110;
for (const r of [...ROUTES, { path: '/404.html', h1: null }]) {
  const file = r.path.endsWith('.html') ? join(dist, r.path) : join(dist, r.path, 'index.html');
  if (!existsSync(file)) { fails.push(`missing ${file}`); continue; }
  const html = readFileSync(file, 'utf8');
  const is404 = r.path === '/404.html';
  const get = (re) => html.match(re)?.[1];
  const title = get(/<title>([^<]*)<\/title>/);
  const desc = get(/<meta name="description" content="([^"]*)"/);
  ok(title && title.length >= 20 && title.length <= 70, `${r.path}: title length ${title?.length}`);
  ok(!/\b(white|react|vite)\b/i.test(title ?? ''), `${r.path}: title contains a banned word`);
  ok(!titles.has(title), `${r.path}: duplicate title`);
  titles.add(title);
  ok(desc && desc.length >= 70 && desc.length <= 170, `${r.path}: description length ${desc?.length}`);
  ok((html.match(/<h1[\s>]/g) ?? []).length === 1, `${r.path}: expected exactly one h1`);
  ok((html.match(/<title>/g) ?? []).length === 1, `${r.path}: multiple titles`);
  const canonical = get(/<link rel="canonical" href="([^"]*)"/);
  if (is404) ok(!canonical && /noindex/.test(html), '404: must be noindex without canonical');
  else ok(canonical === `${SITE.url}${r.path}`, `${r.path}: canonical ${canonical}`);
  const ld = get(/<script type="application\/ld\+json" id="ld">([\s\S]*?)<\/script>/);
  try { JSON.parse(ld); } catch { fails.push(`${r.path}: invalid JSON-LD`); }
  for (const m of html.matchAll(/<img\b[^>]*>/g)) ok(/\balt="[^"]+"/.test(m[0]), `${r.path}: img without alt: ${m[0].slice(0, 80)}`);
  const og = get(/property="og:image" content="([^"]*)"/);
  ok(og && existsSync(join(dist, og.replace(SITE.url, ''))), `${r.path}: og:image file missing (${og})`);
  for (const m of html.matchAll(/href="(\/[^"#]*)(?:#[^"]*)?"/g)) {
    const p = m[1];
    const target = p.endsWith('/') ? join(dist, p, 'index.html') : join(dist, p);
    ok(existsSync(target), `${r.path}: broken internal link ${p}`);
  }
  for (const m of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) ok(existsSync(join(dist, m[1])), `${r.path}: missing asset ${m[1]}`);
  // Initial JS = entry + page chunk (+ their static imports), gzip.
  const entry = get(/<script type="module" src="([^"]+)"/);
  const preload = get(/<link rel="modulepreload" href="([^"]+)"/);
  const seen = new Set();
  const visit = (p) => {
    if (!p || seen.has(p)) return;
    seen.add(p);
    const src = readFileSync(join(dist, p), 'utf8');
    for (const m of src.matchAll(/^import[^"']*["'](\.[^"']+)["']|from["'](\.[^"']+)["']/g)) {
      const rel = m[1] || m[2];
      visit('/' + join(dirname(p), rel).replace(/\\/g, '/').replace(/^\//, ''));
    }
  };
  visit(entry); visit(preload);
  const kb = [...seen].reduce((n, p) => n + gz(join(dist, p)), 0) / 1024;
  console.log(`${r.path.padEnd(16)} initial JS ${kb.toFixed(1)} kB gzip, title ${title?.length} chars, desc ${desc?.length} chars`);
  ok(kb <= BUDGET_KB, `${r.path}: initial JS ${kb.toFixed(1)} kB gzip exceeds ${BUDGET_KB} kB`);
}
for (const f of ['sitemap.xml', 'robots.txt', 'llms.txt', 'favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'site.webmanifest']) ok(existsSync(join(dist, f)), `missing ${f}`);
const sm = existsSync(join(dist, 'sitemap.xml')) ? readFileSync(join(dist, 'sitemap.xml'), 'utf8') : '';
for (const r of ROUTES) ok(sm.includes(`<loc>${SITE.url}${r.path}</loc>`), `sitemap lacks ${r.path}`);
ok(!sm.includes('404'), 'sitemap lists the 404 page');
ok(/Sitemap: /.test(readFileSync(join(dist, 'robots.txt'), 'utf8')), 'robots.txt lacks Sitemap');

if (fails.length) { console.error('\nCHECK FAILED:\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('\ncheck OK: seo, structure, links, bundle budget, no source maps');
