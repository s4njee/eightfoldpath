import { writeFileSync } from 'node:fs';
import { describe, it, vi } from 'vitest';
import { mountHeadless } from '../tests/headless.ts';
import { boxDownLuma, luma, Means, popping } from './texel-metrics.ts';

// Definition of done, item 5, for the diorama (stories 4.2 and 4.3): does the pixel art hold still
// while the camera moves? The diorama under its sway, sped up so the camera moves about as fast as a
// visitor's pan, rendered at 640 × 360 and against a 4 × 4 supersampled reference. Popping (the
// temporal second difference, experiments/texel-metrics.ts) near the reference's means texels
// glide; well above it means they crawl.
//
//   npx vitest run --silent=false --config experiments/vite.config.ts experiments/diorama-stability.test.ts
//
// Writes experiments/diorama-stability-<size>.json.

vi.setConfig({ testTimeout: 1_800_000 });

// EFP_SIZE=1280x720 EFP_SUPERSAMPLE=3 for a larger canvas.
const SIZE = (process.env.EFP_SIZE ?? '640x360').split('x').map(Number) as [number, number];
const SUPERSAMPLE = Number(process.env.EFP_SUPERSAMPLE ?? 4);
const FRAMES = 30;
const CASES: Record<string, Record<string, unknown>> = {
  'default camera, fast sway': { sway: 0.6 },
  'top down, fast sway': { sway: 0.6, pitch: 70, fov: 30 },
  'rig tour, perspective': { mode: 'path', tourSeconds: 8 },
  'rig tour, orthographic': { mode: 'path', tourSeconds: 8, projection: 'orthographic' },
};

async function render(
  id: string,
  scale: number,
  params: Record<string, unknown>,
): Promise<Float32Array[]> {
  const width = SIZE[0] * scale;
  const height = SIZE[1] * scale;
  const mounted = await mountHeadless(id, { width, height, params });
  const frames: Float32Array[] = [];
  for (let frame = 0; frame < FRAMES; frame++) {
    // Frame 0 every time, so the output pass's per-frame dither is not counted as popping.
    const encoder = mounted.device.createCommandEncoder();
    mounted.instance.frame(
      { time: 2 + frame / 60, delta: frame ? 1 / 60 : 2, frame: 0 },
      encoder,
      mounted.target.createView(),
    );
    mounted.device.queue.submit([encoder.finish()]);
    const rgba = await mounted.read();
    frames.push(scale > 1 ? boxDownLuma(rgba, width, height, scale) : luma(rgba, width, height));
  }
  mounted.destroy();
  return frames;
}

describe.skipIf(process.env.CI)('diorama stability', () => {
  it('measures popping under camera motion', async () => {
    const results: Record<string, number | string>[] = [];
    for (const [name, params] of Object.entries(CASES)) {
      const id = name.startsWith('rig') ? 'camera-rig' : 'diorama';
      const row: Record<string, number | string> = { case: name };
      for (const [label, scale] of [
        ['pop', 1],
        ['popReference', SUPERSAMPLE],
      ] as const) {
        const frames = await render(id, scale, params);
        const means = new Means();
        // Skip the first frames, while the camera eases in from rest.
        for (let t = 5; t < FRAMES - 1; t++) {
          means.add(label, popping(frames[t - 1]!, frames[t]!, frames[t + 1]!));
        }
        row[label] = Number(means.get(label).toFixed(3));
      }
      results.push(row);
      console.log(JSON.stringify(row));
    }
    writeFileSync(
      `experiments/diorama-stability-${SIZE.join('x')}.json`,
      JSON.stringify(results, null, 2) + '\n',
    );
  });
});
