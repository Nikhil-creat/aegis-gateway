/**
 * Static build: Tailwind v4 CSS, code-split client bundle (no source maps), and a prerendered HTML file per route
 * plus 404.html, sitemap.xml, robots.txt and llms.txt. Output goes to dist/.
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, transform } from 'esbuild';
import { compile } from 'tailwindcss';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const tmp = join(root, '.build');
const require = createRequire(import.meta.url);
const SITE_URL = (process.env.SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` || 'https://aegis-gateway.vercel.app').replace(/\/+$/, '');
const BUILD_DATE = process.env.BUILD_DATE || new Date().toISOString().slice(0, 10);
process.env.SITE_URL = SITE_URL;
process.env.BUILD_DATE = BUILD_DATE;

const define = {
  'process.env.SITE_URL': JSON.stringify(SITE_URL),
  'process.env.BUILD_DATE': JSON.stringify(BUILD_DATE),
  'process.env.NODE_ENV': '"production"',
};
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 10);
const walk = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

rmSync(dist, { recursive: true, force: true });
rmSync(tmp, { recursive: true, force: true });
mkdirSync(join(dist, 'assets'), { recursive: true });
mkdirSync(tmp, { recursive: true });

// 1. CSS ----------------------------------------------------------------------------------------------------------
const sources = [...walk(join(root, 'src')).filter((f) => /\.(tsx?|css)$/.test(f)), join(root, 'index.html')];
const candidates = new Set();
for (const f of sources) for (const m of readFileSync(f, 'utf8').matchAll(/[^\s"'`<>={}\\;]+/g)) candidates.add(m[0]);
const twDir = dirname(require.resolve('tailwindcss/package.json'));
const compiler = await compile(readFileSync(join(root, 'src/styles.css'), 'utf8'), {
  base: join(root, 'src'),
  loadStylesheet: async (id, base) => {
    const path = id === 'tailwindcss' ? join(twDir, 'index.css') : id.startsWith('tailwindcss/') ? join(twDir, id.slice(12) + (id.endsWith('.css') ? '' : '.css')) : resolve(base, id);
    return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
  },
});
const css = (await transform(compiler.build([...candidates]), { loader: 'css', minify: true })).code;
const cssName = `assets/styles-${hash(css)}.css`;
writeFileSync(join(dist, cssName), css);

// 2. Client bundle ------------------------------------------------------------------------------------------------
const client = await build({
  entryPoints: { main: join(root, 'src/main.tsx') },
  outdir: join(dist, 'assets'),
  entryNames: '[name]-[hash]',
  chunkNames: 'chunks/[name]-[hash]',
  bundle: true, splitting: true, format: 'esm', target: 'es2022', platform: 'browser',
  minify: true, sourcemap: false, legalComments: 'none', jsx: 'automatic', define, metafile: true, logLevel: 'warning',
});
const outs = client.metafile.outputs;
const rel = (p) => '/' + relative(dist, join(root, p)).split('\\').join('/');
const entryOut = Object.keys(outs).find((o) => outs[o].entryPoint?.endsWith('src/main.tsx'));
const pageChunk = {};
for (const [o, meta] of Object.entries(outs)) {
  const m = meta.entryPoint?.match(/src\/pages\/(\w+)\.tsx$/);
  if (m) pageChunk[m[1]] = rel(o);
}

// 3. Server bundle (render only; never shipped) --------------------------------------------------------------------
const ssrFile = join(tmp, 'entry-server.mjs');
await build({
  entryPoints: [join(root, 'src/entry-server.tsx')], outfile: ssrFile, bundle: true, format: 'esm', platform: 'node', packages: 'external',
  jsx: 'automatic', define, logLevel: 'warning', sourcemap: false,
});
const { render } = await import(pathToFileURL(ssrFile).href);
const { ROUTES, SITE } = await import(pathToFileURL(await bundleModule('site.config.ts')).href);
const { headHtml } = await import(pathToFileURL(await bundleModule('src/seo.ts')).href);

async function bundleModule(file) {
  const out = join(tmp, file.replace(/[\\/]/g, '_').replace(/\.ts$/, '.mjs'));
  await build({ entryPoints: [join(root, file)], outfile: out, bundle: true, format: 'esm', platform: 'node', packages: 'external', define, logLevel: 'warning' });
  return out;
}

// 4. Prerender -----------------------------------------------------------------------------------------------------
const template = readFileSync(join(root, 'index.html'), 'utf8');
const PAGE_FILE = { '/': 'Home', '/playground/': 'Playground', '/architecture/': 'Architecture', '/benchmarks/': 'Benchmarks', '/security/': 'Security', '/about/': 'About', '404': 'NotFound' };
const page = (path, route) => {
  const key = route ? route.path : '404';
  const chunk = pageChunk[PAGE_FILE[key]];
  const assets = [`<link rel="stylesheet" href="/${cssName}" />`, chunk ? `<link rel="modulepreload" href="${chunk}" />` : ''].filter(Boolean).join('\n    ');
  return template
    .replace('<!--HEAD-->', headHtml(route))
    .replace('<!--ASSETS-->', assets)
    .replace('<!--ROOT-->', render(path))
    .replace('<!--SCRIPT-->', `<script type="module" src="${rel(entryOut)}"></script>`);
};
for (const r of ROUTES) {
  const dir = r.path === '/' ? dist : join(dist, r.path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), page(r.path, r));
}
writeFileSync(join(dist, '404.html'), page('/404/', undefined));

// 5. Crawler files -------------------------------------------------------------------------------------------------
const abs = (p) => `${SITE_URL}${p}`;
writeFileSync(join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${ROUTES.map((r) => `  <url>\n    <loc>${abs(r.path)}</loc>\n    <lastmod>${BUILD_DATE}</lastmod>\n    <priority>${r.priority.toFixed(1)}</priority>\n  </url>`).join('\n')}
</urlset>
`);
writeFileSync(join(dist, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${abs('/sitemap.xml')}\n`);
writeFileSync(join(dist, 'llms.txt'), `# ${SITE.name}

> ${SITE.tagline}. An open-source FastAPI gateway that routes LLM requests between cheap and strong models, fails over across Groq and Gemini, logs cost and latency, and scores agents with a fixed 30-task evaluation. Built by ${SITE.author.name}.

Note: published benchmark numbers come from a synthetic mock provider unless a page says they are live.

## Pages
${ROUTES.map((r) => `- [${r.label}](${abs(r.path)}): ${r.description}`).join('\n')}

## Source
- [GitHub repository](${SITE.repo}): Python gateway, evaluation harness, tests and this website
- [Sitemap](${abs('/sitemap.xml')})

## Author
- [${SITE.author.name}](${abs('/about/')}): ${SITE.author.locality}, ${SITE.author.region}, India
`);

// 6. Static assets -------------------------------------------------------------------------------------------------
if (existsSync(join(root, 'public'))) cpSync(join(root, 'public'), dist, { recursive: true });
rmSync(tmp, { recursive: true, force: true });

const kb = (p) => (statSync(p).size / 1024).toFixed(1);
console.log(`built ${ROUTES.length} pages + 404 for ${SITE_URL}`);
for (const o of Object.keys(outs)) console.log(`  ${relative(dist, join(root, o)).padEnd(46)} ${kb(join(root, o)).padStart(7)} kB`);
console.log(`  ${cssName.padEnd(46)} ${kb(join(dist, cssName)).padStart(7)} kB`);
