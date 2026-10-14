import { describe, expect, it } from 'vitest';
import { loadEffect } from '../src/effects/registry.ts';
import { defaultParams, type InspectState } from '../src/effects/types.ts';
import { EIGHTFOLD, rgb8ToOklab, distance2 } from '../src/gpu/palette/index.ts';
import { noProfiler } from '../src/gpu/profiler.ts';
import { fakeCanvas } from './headless.ts';
import { getTestDevice, readTexture } from './gpu.ts';

const WIDTH = 320;
const HEIGHT = 180;
const PALETTE = new Set(EIGHTFOLD.map(([r, g, b]) => (r << 16) | (g << 8) | b));

async function render(
  params: Record<string, unknown>,
  off: readonly string[] = [],
): Promise<Uint8Array> {
  const device = await getTestDevice();
  const effect = await loadEffect('palette-mapping');
  const target = device.createTexture({
    size: [WIDTH, HEIGHT],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const inspect: InspectState = { view: 'final', off: new Set(off) };
  const instance = await effect.create({
    device,
    format: 'rgba8unorm',
    canvas: fakeCanvas(WIDTH, HEIGHT),
    params: { ...defaultParams(effect.params), ...params } as never,
    profiler: noProfiler,
    inspect,
  });
  instance.resize(WIDTH, HEIGHT, 1);
  const encoder = device.createCommandEncoder();
  instance.frame({ time: 1, delta: 1 / 60, frame: 1 }, encoder, target.createView());
  device.queue.submit([encoder.finish()]);
  const pixels = await readTexture(device, target);
  instance.destroy();
  target.destroy();
  return pixels;
}

function paletteShare(rgba: Uint8Array): number {
  let inside = 0;
  for (let p = 0; p < rgba.length; p += 4) {
    if (PALETTE.has((rgba[p]! << 16) | (rgba[p + 1]! << 8) | rgba[p + 2]!)) inside++;
  }
  return inside / (rgba.length / 4);
}

/**
 * Mean OKLab distance between two pictures after averaging each over `box` × `box` squares: how
 * far the mapped picture's local average colour drifts from the original's. Dither exists to
 * keep that average, so it should lower this even though every single pixel moves further.
 */
function blurredError(a: Uint8Array, b: Uint8Array, box = 8): number {
  const linear = (byte: number) => {
    const c = byte / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const toByte = (c: number) => {
    const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, s)) * 255);
  };
  let total = 0;
  let count = 0;
  for (let y = 0; y + box <= HEIGHT; y += box) {
    for (let x = 0; x + box <= WIDTH; x += box) {
      const sum = [0, 0, 0, 0, 0, 0];
      for (let dy = 0; dy < box; dy++) {
        for (let dx = 0; dx < box; dx++) {
          const p = ((y + dy) * WIDTH + x + dx) * 4;
          for (let c = 0; c < 3; c++) {
            sum[c]! += linear(a[p + c]!);
            sum[c + 3]! += linear(b[p + c]!);
          }
        }
      }
      const n = box * box;
      const average = (o: number) =>
        rgb8ToOklab([toByte(sum[o]! / n), toByte(sum[o + 1]! / n), toByte(sum[o + 2]! / n)]);
      total += Math.sqrt(distance2(average(0), average(3)));
      count++;
    }
  }
  return total / count;
}

describe('palette mapping', () => {
  it('draws only palette colours, from an illustration and from the ramp-shaded scene', async () => {
    for (const params of [
      {},
      { dither: 'blue noise' },
      { source: 'lit scene', shading: 'palette ramp' },
      { source: 'lit scene', shading: 'nearest colour' },
    ]) {
      expect(paletteShare(await render(params)), JSON.stringify(params)).toBe(1);
    }
  });

  it('draws only palette colours with the exact search too, and mostly the same ones', async () => {
    const lut = await render({ dither: 'none' });
    const exact = await render({ dither: 'none' }, ['lut']);
    expect(paletteShare(exact)).toBe(1);
    let differ = 0;
    for (let p = 0; p < lut.length; p += 4) {
      if (lut[p] !== exact[p] || lut[p + 1] !== exact[p + 1] || lut[p + 2] !== exact[p + 2])
        differ++;
    }
    const share = differ / (lut.length / 4);
    console.info(
      `palette-mapping: LUT and exact search differ on ${(share * 100).toFixed(2)}% of the town's pixels`,
    );
    // About 11% on the dark town: the darks are where the palette is densest and 32 sRGB steps
    // coarsest relative to it. The colours picked instead are near misses (tests/palette-lut.test.ts).
    expect(share).toBeLessThan(0.15);
  });

  it('keeps the local average colour closer with dither than without', async () => {
    const results: Record<string, number> = {};
    for (const source of ['town', 'lit scene']) {
      const original = await render({ source, shading: 'nearest colour', pixelSize: 1 }, [
        'palette',
      ]);
      for (const dither of ['none', 'bayer', 'blue noise']) {
        const mapped = await render({ source, shading: 'nearest colour', pixelSize: 1, dither });
        results[`${source} ${dither}`] = blurredError(original, mapped);
      }
    }
    console.info(
      `palette-mapping blurred OKLab error (8 × 8 box): ${Object.entries(results)
        .map(([name, value]) => `${name} ${value.toFixed(4)}`)
        .join(', ')}`,
    );
    for (const source of ['town', 'lit scene']) {
      expect(results[`${source} bayer`]).toBeLessThan(results[`${source} none`]!);
      expect(results[`${source} blue noise`]).toBeLessThan(results[`${source} none`]!);
    }
  });
});
