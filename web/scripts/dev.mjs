/** Rebuild on change and serve dist/. For quick local iteration: npm run dev */
import { spawnSync } from 'node:child_process';
import { watch } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rebuild = () => spawnSync('node', ['scripts/build.mjs'], { cwd: root, stdio: 'inherit' });
rebuild();
let timer;
for (const d of ['src', 'lib', 'public']) {
  watch(join(root, d), { recursive: true }, () => { clearTimeout(timer); timer = setTimeout(rebuild, 200); });
}
await import('./serve.mjs').then((m) => m.server.listen(4173, () => console.log('dev server: http://localhost:4173 (rebuilds on change, refresh to see it)')));
