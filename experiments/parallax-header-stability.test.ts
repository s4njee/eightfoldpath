import { describe, it, vi } from 'vitest';
import { mountHeadless } from '../tests/headless.ts';
import { luma, meanAbsDiff, popping } from './texel-metrics.ts';

// Does the drift make texels shimmer? Story 3.1's popping metric (the mean temporal second
// difference of luma, texel-metrics.ts) over consecutive frames of the parallax header drifting at
// its default speed, at canvas sizes that give fractional pixels per texel. Story 3.1 measured
// 0.92 to 1.20 for sharp sampling and about 3.7 for nearest under its own camera motion.
//
//   npx vitest run --silent=false --config experiments/vite.config.ts experiments/parallax-header-stability.test.ts

vi.setConfig({ testTimeout: 600_000 });

/** Canvas sizes: 6.25, 5.27 and 3.13 pixels per texel at the default 64 texels tall. */
const SIZES: readonly (readonly [number, number])[] = [
  [1280, 400],
  [1000, 337],
  [640, 200],
];
const FRAMES = 40;

/** Everything that is not the drift switched off, so only the sampling is measured. */
const STILL = { pointer: 0, scroll: 0, wind: 0, sun: false, shafts: 0, haze: 0, bloom: 0 };

describe('parallax header stability', () => {
  it.each(SIZES)('%ix%i', async (width, height) => {
    for (const [name, params] of [
      ['sharp, in focus', { ...STILL, aperture: 0 }],
      ['nearest, in focus', { ...STILL, aperture: 0, sampling: 'nearest' }],
      ['default depth of field', STILL],
    ] as const) {
      const mounted = await mountHeadless('parallax-header', { width, height, params });
      const frames: Float32Array[] = [];
      for (let i = 0; i < FRAMES; i++) {
        // Frame 0 every time, as in story 3.1's study: the output dither changes per frame, and
        // its one-step noise would otherwise be measured as popping everywhere.
        const encoder = mounted.device.createCommandEncoder();
        mounted.instance.frame(
          { time: 2 + i / 60, delta: 1 / 60, frame: 0 },
          encoder,
          mounted.target.createView(),
        );
        mounted.device.queue.submit([encoder.finish()]);
        frames.push(luma(await mounted.read(), width, height));
      }
      mounted.destroy();
      let pop = 0;
      let change = 0;
      for (let i = 1; i < FRAMES - 1; i++) {
        pop += popping(frames[i - 1]!, frames[i]!, frames[i + 1]!);
        change += meanAbsDiff(frames[i]!, frames[i + 1]!);
      }
      const n = FRAMES - 2;
      console.log(
        `${width}x${height} ${name}: popping ${(pop / n).toFixed(3)}, frame difference ${(change / n).toFixed(3)}`,
      );
    }
  });
});
