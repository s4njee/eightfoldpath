import { writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { describe, it, vi } from 'vitest';
import { loadEffect } from '../src/effects/registry.ts';
import { defaultParams, type InspectState } from '../src/effects/types.ts';
import { noProfiler } from '../src/gpu/profiler.ts';
import { getTestDevice, readTexture } from '../tests/gpu.ts';
import { fakeCanvas } from '../tests/headless.ts';
import { luma, Means, popping } from './texel-metrics.ts';

// Story 3.8's measurement: does the low-resolution path hold still and glide, and how much of what
// it draws is exactly the palette?
//
//   npx vitest run --silent=false --config experiments/vite.config.ts experiments/lowres-path-study.test.ts
//
// For each variant the camera pans slowly for FRAMES frames and two things are measured:
//
// - swim: the virtual image itself (read through the inspector's `virtual` view), compared with
//   the previous frame moved by the best whole-pixel shift. Zero means the picture only ever moves
//   by whole pixels, so no texel changes shape. The walker is stopped so only the camera moves.
// - pop: the temporal second difference of the final canvas (experiments/texel-metrics.ts), which
//   is high when the picture steps or texels flicker, and low when it glides.
//
// Palette adherence is the share of drawn canvas pixels (not the clear colour) whose colour is
// within one 8-bit step of a palette entry, for the scorecard's `paletteAdherence`.

vi.setConfig({ testTimeout: 3_600_000 });

const FRAMES = 60;
const CANVASES: [number, number][] = [
  [960, 540], // scale 3
  [1366, 768], // scale 4.27
];

const palette = readFileSync('assets/palette/eightfold.hex', 'utf8')
  .split(/\s+/)
  .filter(Boolean)
  .map(
    (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number],
  );

async function mount(
  width: number,
  height: number,
  params: Record<string, unknown>,
  inspect: InspectState,
) {
  const device = await getTestDevice();
  const effect = await loadEffect('low-res-path');
  const target = device.createTexture({
    size: [width, height],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const instance = await effect.create({
    device,
    format: 'rgba8unorm',
    canvas: fakeCanvas(width, height),
    params: { ...defaultParams(effect.params), ...params } as never,
    profiler: noProfiler,
    inspect,
  });
  instance.resize(width, height, 1);
  let frame = 0;
  return {
    async step(): Promise<Uint8Array> {
      const encoder = device.createCommandEncoder();
      // Frame 0 every time, so the output pass's dither pattern holds still (see texel-sampling-study).
      instance.frame({ time: frame / 60, delta: 1 / 60, frame: 0 }, encoder, target.createView());
      device.queue.submit([encoder.finish()]);
      frame++;
      return readTexture(device, target);
    },
    stats: () => instance.stats!(),
    destroy() {
      instance.destroy();
      target.destroy();
    },
  };
}

/** The virtual image, recovered from the `virtual` view by reading one canvas pixel per virtual pixel. */
function virtualFrom(rgba: Uint8Array, width: number, height: number, vw: number, vh: number) {
  const out = new Float32Array(vw * vh);
  const lum = luma(rgba, width, height);
  for (let y = 0; y < vh; y++) {
    const sy = Math.floor(((y + 0.5) * height) / vh);
    for (let x = 0; x < vw; x++) {
      out[y * vw + x] = lum[sy * width + Math.floor(((x + 0.5) * width) / vw)]!;
    }
  }
  return out;
}

/** Share of interior pixels that differ from `previous` moved by the best whole-pixel shift. */
function swim(
  previous: Float32Array,
  current: Float32Array,
  width: number,
  height: number,
  inset: number,
) {
  let best = 1;
  for (let sy = -2; sy <= 2; sy++) {
    for (let sx = -2; sx <= 2; sx++) {
      let differ = 0;
      let count = 0;
      for (let y = inset; y < height - inset; y++) {
        for (let x = inset; x < width - inset; x++) {
          count++;
          // Over the dither's one step, which is fixed to the canvas, not the picture.
          if (Math.abs(current[y * width + x]! - previous[(y + sy) * width + x + sx]!) > 2.5)
            differ++;
        }
      }
      best = Math.min(best, differ / count);
    }
  }
  return best;
}

/** low-res-path's clear colour, linear, as the 8-bit sRGB the canvas shows. */
const CLEAR = [0.02, 0.022, 0.04].map((c) => Math.round((1.055 * c ** (1 / 2.4) - 0.055) * 255));

function adherence(rgba: Uint8Array): number {
  let drawn = 0;
  let exact = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const [r, g, b] = [rgba[i]!, rgba[i + 1]!, rgba[i + 2]!];
    // The clear colour is not art.
    if ([r, g, b].every((c, k) => Math.abs(c - CLEAR[k]!) <= 1)) continue;
    drawn++;
    if (
      palette.some(
        (p) => Math.abs(p[0] - r) <= 1 && Math.abs(p[1] - g) <= 1 && Math.abs(p[2] - b) <= 1,
      )
    )
      exact++;
  }
  return exact / Math.max(1, drawn);
}

const VARIANTS: { name: string; params: Record<string, unknown>; off: string[] }[] = [
  { name: 'low-res, sharp', params: { upscale: 'sharp' }, off: [] },
  { name: 'low-res, nearest', params: { upscale: 'nearest' }, off: [] },
  { name: 'low-res, bilinear', params: { upscale: 'bilinear' }, off: [] },
  { name: 'no sub-pixel offset', params: { upscale: 'sharp' }, off: ['sub-pixel offset'] },
  { name: 'no snapping', params: { upscale: 'sharp' }, off: ['snapping'] },
  { name: 'full resolution', params: {}, off: ['low-res'] },
];

describe.skipIf(process.env.CI)('low-res path study', () => {
  it('measures swim, pop and palette adherence', async () => {
    const results: Record<string, unknown>[] = [];
    for (const projection of ['perspective', 'orthographic']) {
      for (const [width, height] of CANVASES) {
        for (const variant of VARIANTS) {
          const params = { projection, walk: 0, speed: 0.4, motion: 'pan', ...variant.params };
          const m = new Means();
          // The final picture.
          const final = await mount(width, height, params, {
            view: 'final',
            off: new Set(variant.off),
          });
          const frames: Float32Array[] = [];
          let palettes = 0;
          for (let frame = 0; frame < FRAMES; frame++) {
            const rgba = await final.step();
            frames.push(luma(rgba, width, height));
            if (frame % 10 === 0) {
              m.add('palette', adherence(rgba));
              palettes++;
            }
          }
          const stats = final.stats();
          final.destroy();
          for (let t = 1; t < FRAMES - 1; t++)
            m.add('pop', popping(frames[t - 1]!, frames[t]!, frames[t + 1]!));

          // The virtual image, where there is one.
          if (!variant.off.includes('low-res')) {
            const [vw, vh] = String(stats.virtual).split('×').map(Number) as [number, number];
            const total = [vw + 4, vh + 4] as const;
            const raw = await mount(width, height, params, {
              view: 'virtual',
              off: new Set(variant.off),
            });
            let previous: Float32Array | undefined;
            for (let frame = 0; frame < FRAMES; frame++) {
              const current = virtualFrom(await raw.step(), width, height, total[0], total[1]);
              if (previous) m.add('swim', swim(previous, current, total[0], total[1], 4));
              previous = current;
            }
            raw.destroy();
          }
          const row = {
            projection,
            canvas: `${width}x${height}`,
            scale: stats.scale,
            variant: variant.name,
            ...m.toJSON(4),
          };
          results.push(row);
          console.log(JSON.stringify(row), palettes);
        }
      }
    }
    writeFileSync(
      'experiments/lowres-path-results.json',
      `${JSON.stringify({ frames: FRAMES, results }, null, 1)}\n`,
    );
  });
});
