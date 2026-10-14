// How long normalsFromAlpha takes on each sprite in assets/sprites (story 3.3's notes quote it).
//
//   npx vitest run --silent=false --config experiments/vite.config.ts \
//     experiments/sprite-light-normals-timing.test.ts
import { it } from 'vitest';
import { readdirSync } from 'node:fs';
import { loadPixels } from '../src/gpu/assets.ts';
import { normalsFromAlpha } from '../src/gpu/lighting/normals.ts';
it('times', async () => {
  for (const name of readdirSync('assets/sprites')) {
    const p = await loadPixels('/assets/sprites/' + name);
    normalsFromAlpha(p);
    const t = performance.now();
    for (let i = 0; i < 20; i++) normalsFromAlpha(p, { radius: 5 });
    console.log(name, p.width, p.height, ((performance.now() - t) / 20).toFixed(3), 'ms');
  }
});
