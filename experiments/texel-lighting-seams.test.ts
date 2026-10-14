import { describe, it, vi } from 'vitest';
import { loadEffect } from '../src/effects/registry.ts';
import { defaultParams, type InspectState } from '../src/effects/types.ts';
import { noProfiler } from '../src/gpu/profiler.ts';
import { getTestDevice, readTexture } from '../tests/gpu.ts';
import { fakeCanvas, writePng } from '../tests/headless.ts';

// Story 3.9's seam check, by eye: the texel grid and the lighting looked at from straight above
// where the cobble and grass tiles meet, with the lamp over the join, snapped and per pixel.
//
//   npx vitest run --silent=false --config experiments/vite.config.ts experiments/texel-lighting-seams.test.ts
//
// Writes output/shots/texel-lighting-seam-*.png.

vi.setConfig({ testTimeout: 600_000 });

const WIDTH = 960;
const HEIGHT = 540;

describe('texel-lighting seams', () => {
  it('renders the tile join', async () => {
    const device = await getTestDevice();
    const effect = await loadEffect('texel-lighting');
    const target = device.createTexture({
      size: [WIDTH, HEIGHT],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const shots: [string, string, string[]][] = [
      ['grid', 'texel grid', []],
      ['snapped', 'final', []],
      ['per-pixel', 'final', ['texel snapping']],
    ];
    for (const [name, view, off] of shots) {
      const inspect: InspectState = { view, off: new Set(off) };
      const instance = await effect.create({
        device,
        format: 'rgba8unorm',
        canvas: fakeCanvas(WIDTH, HEIGHT),
        // Straight down at the join, the lamp parked over it (phase ~ -pi/2 puts it at x = 0).
        params: {
          ...defaultParams(effect.params),
          pitch: 80,
          framing: 2.2,
          bands: 6,
          lightSpeed: 0,
        } as never,
        profiler: noProfiler,
        inspect,
      });
      instance.resize(WIDTH, HEIGHT, 1);
      const encoder = device.createCommandEncoder();
      instance.frame({ time: 0, delta: 0, frame: 0 }, encoder, target.createView());
      device.queue.submit([encoder.finish()]);
      const rgba = await readTexture(device, target);
      writePng(
        `output/shots/texel-lighting-seam-${name}.png`,
        WIDTH,
        HEIGHT,
        rgba.filter((_, i) => i % 4 !== 3),
      );
      instance.destroy();
    }
    target.destroy();
  });
});
