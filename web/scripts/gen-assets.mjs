/** Regenerates favicons and 1200x630 social images into public/. Run: node scripts/gen-assets.mjs (needs sharp). */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
mkdirSync(join(pub, 'og'), { recursive: true });
const PATH = 'M 144 256 L 27.598 256 L 144 139.598 Z M 256 207.5 L 200 256 L 200 56 L 0 56 L 48 0 L 256 0 Z M 0 204.402 L 0 112 L 92.402 112 Z';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const icon = (pad, bg) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="${bg ? 56 : 0}" fill="#191919"/><g transform="translate(${pad} ${pad}) scale(${(256 - pad * 2) / 256})"><path d="${PATH}" fill="#fff"/></g></svg>`;
writeFileSync(join(pub, 'favicon.svg'), icon(48, true));
const png = (size, svg) => sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toBuffer();
const p32 = await png(32, icon(40, true));
const p48 = await png(48, icon(40, true));
await sharp(await png(180, icon(44, false))).toFile(join(pub, 'apple-touch-icon.png'));
await sharp(await png(192, icon(40, true))).toFile(join(pub, 'icon-192.png'));
await sharp(await png(512, icon(40, true))).toFile(join(pub, 'icon-512.png'));
await sharp(p32).toFile(join(pub, 'favicon-32.png'));

// favicon.ico: one 48x48 PNG-in-ICO entry
const ico = Buffer.alloc(22);
ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
ico[6] = 48; ico[7] = 48; ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12); ico.writeUInt32LE(p48.length, 14); ico.writeUInt32LE(22, 18);
writeFileSync(join(pub, 'favicon.ico'), Buffer.concat([ico, p48]));

writeFileSync(join(pub, 'site.webmanifest'), JSON.stringify({
  name: 'Aegis AI Gateway', short_name: 'Aegis', description: 'Auto-routing, LLMOps and agent evals in one gateway',
  start_url: '/', display: 'standalone', background_color: '#ffffff', theme_color: '#191919',
  icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
}, null, 2) + '\n');

const PAGES = {
  home: ['Route every request', 'to the right model.', 'LLM gateway · auto-routing · failover · agent evals'],
  playground: ['Live gateway', 'playground', 'Watch routing, tools, failover and cost per request'],
  architecture: ['How the gateway', 'decides', 'Pipeline, router heuristics, failover and design decisions'],
  benchmarks: ['Does auto-routing', 'save money?', '30-task agent exam · cost vs pass rate · CI gate'],
  security: ['Security model', 'and honest limits', 'Threat model, controls and what to harden next'],
  about: ['Built by', 'Nikhil Chary Sriramoju', 'Final-year CSE · AI infrastructure · Warangal, India'],
};
for (const [slug, [l1, l2, sub]] of Object.entries(PAGES)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#fff"/>
<defs><pattern id="d" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.2" fill="#191919" fill-opacity=".1"/></pattern></defs>
<rect width="1200" height="630" fill="url(#d)"/>
<rect x="0" y="0" width="1200" height="630" fill="none" stroke="#e5e7eb" stroke-width="2"/>
<g transform="translate(80 72) scale(.19)"><path d="${PATH}" fill="#191919"/></g>
<text x="146" y="108" font-family="Helvetica, Arial, sans-serif" font-size="30" font-weight="700" fill="#191919">Aegis AI Gateway</text>
<text x="80" y="330" font-family="Georgia, serif" font-size="88" fill="#191919" letter-spacing="-3">${esc(l1)}</text>
<text x="80" y="428" font-family="Georgia, serif" font-size="${l2.length > 20 ? 72 : 88}" fill="#191919" letter-spacing="-3">${esc(l2)}</text>
<text x="80" y="510" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="#191919" fill-opacity=".62">${esc(sub)}</text>
<rect x="80" y="560" width="1040" height="2" fill="#191919" fill-opacity=".12"/>
<text x="80" y="596" font-family="Helvetica, Arial, sans-serif" font-size="22" fill="#191919" fill-opacity=".55">FastAPI · Groq + Gemini · SQLite · Docker · CI-gated evals</text>
</svg>`;
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(join(pub, 'og', `${slug}.png`));
}
console.log('assets written to public/');
