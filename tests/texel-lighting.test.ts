import { describe, expect, it } from 'vitest';
import { loadEffect } from '../src/effects/registry.ts';
import { defaultParams, type InspectState } from '../src/effects/types.ts';
import { noProfiler } from '../src/gpu/profiler.ts';
import { getTestDevice, readTexture } from './gpu.ts';
import { fakeCanvas, writePng } from './headless.ts';
import { gpuF32, rowsOf } from './wgsl-eval.ts';

// Story 3.9: shading at texel centres. First the arithmetic of texel-snap.wgsl against an exact
// answer, then the effect itself: with snapping on, every pixel of a texel must get the same light.

describe('texel_centre_offset', () => {
  it('moves a point on an affine texel-to-world map to its texel centre', async () => {
    // World = origin + A · texel for a tilted quad; screen derivatives of the texel coordinates
    // are an arbitrary invertible matrix T, so the world derivatives are A · T.
    const A = [
      [0.0625, 0.01],
      [0.0, -0.05],
      [0.02, 0.03],
    ];
    const T = [
      [0.37, -0.12],
      [0.05, 0.41],
    ];
    const world = (t: [number, number]) => A.map((row) => row[0]! * t[0] + row[1]! * t[1]);
    const dworld = (column: number) =>
      A.map((row) => row[0]! * T[0]![column]! + row[1]! * T[1]![column]!);
    const points: [number, number][] = [
      [3.2, 7.9],
      [10.99, 0.01],
      [0.5, 0.5],
      [41.7, 12.25],
    ];
    const code = `
#include "texel-snap.wgsl"
fn f(x: vec4f) -> vec4f {
  let offset = texel_centre_offset(
    x.xy,
    vec2f(${T[0]![0]}, ${T[1]![0]}),
    vec2f(${T[0]![1]}, ${T[1]![1]}),
    vec3f(${dworld(0).join(', ')}),
    vec3f(${dworld(1).join(', ')}),
  );
  return vec4f(offset, 0.0);
}`;
    const out = await gpuF32(code, rowsOf(points.map(([u, v]) => [u, v, 0, 0])));
    points.forEach((texel, i) => {
      const centre: [number, number] = [Math.floor(texel[0]) + 0.5, Math.floor(texel[1]) + 0.5];
      const expected = world(centre).map((value, k) => value - world(texel)[k]!);
      for (let k = 0; k < 3; k++) expect(out[i * 4 + k]).toBeCloseTo(expected[k]!, 5);
    });
  });

  it('leaves an edge-on texel where it is', async () => {
    const code = `
#include "texel-snap.wgsl"
fn f(x: vec4f) -> vec4f {
  return vec4f(texel_centre_offset(x.xy, vec2f(1.0, 0.0), vec2f(2.0, 0.0), vec3f(1.0), vec3f(1.0)), 0.0);
}`;
    const out = await gpuF32(code, rowsOf([[3.3, 4.4, 0, 0]]));
    expect([...out.slice(0, 3)]).toEqual([0, 0, 0]);
  });

  it('fades out once texels are smaller than pixels', async () => {
    const code = `
#include "texel-snap.wgsl"
fn f(x: vec4f) -> vec4f { return vec4f(texel_snap_weight(x.xy)); }`;
    const out = await gpuF32(
      code,
      rowsOf([
        [0.3, 0.2, 0, 0],
        [1, 0.5, 0, 0],
        [1.5, 1, 0, 0],
        [3, 3, 0, 0],
      ]),
    );
    expect([out[0], out[4], out[8], out[12]]).toEqual([1, 1, 0.5, 0]);
  });
});

const WIDTH = 480;
const HEIGHT = 270;

async function render(view: string, off: string[], params: Record<string, unknown>) {
  const device = await getTestDevice();
  const effect = await loadEffect('texel-lighting');
  const target = device.createTexture({
    size: [WIDTH, HEIGHT],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const inspect: InspectState = { view, off: new Set(off) };
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
  // Frame 0, so the output pass's dither is the same pattern in every picture compared.
  instance.frame({ time: 0, delta: 0, frame: 0 }, encoder, target.createView());
  device.queue.submit([encoder.finish()]);
  const pixels = await readTexture(device, target);
  instance.destroy();
  target.destroy();
  return pixels;
}

/**
 * Of the horizontally adjacent pixel pairs that lie in the same texel (same colour in the texel
 * grid view), the share whose light differs by more than the dither's one step: light edges that
 * cut through a texel ("mixels").
 */
function splitTexels(grid: Uint8Array, light: Uint8Array): { pairs: number; split: number } {
  let pairs = 0;
  let split = 0;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH - 1; x++) {
      const a = (y * WIDTH + x) * 4;
      const b = a + 4;
      // Neighbouring texels differ by far more than the dither's one step in at least one channel.
      if ([0, 1, 2].some((c) => Math.abs(grid[a + c]! - grid[b + c]!) > 2)) continue;
      // Skip the clear colour, where there is no texel at all (the grid's red is never that dark).
      if (grid[a]! < 60) continue;
      pairs++;
      const differs = [0, 1, 2].some((c) => Math.abs(light[a + c]! - light[b + c]!) > 2);
      if (differs) split++;
    }
  }
  return { pairs, split: split / Math.max(1, pairs) };
}

describe('texel-lighting', () => {
  // Close up, so texels are several pixels wide and a split is possible. Stepped light, because a
  // smooth gradient changes by less than the dither's step across one texel and cannot be told
  // from noise this way; the steps' edges are what a viewer sees cut through a texel anyway.
  it.each([
    ['4 steps', 4, 0.002],
    ['8 steps', 8, 0.004],
  ])('lights every pixel of a texel alike (%s light)', async (name, bands, perPixelAtLeast) => {
    const params = { framing: 3, bands };
    const grid = await render('texel grid', [], params);
    const snapped = await render('lighting', [], params);
    const perPixel = await render('lighting', ['texel snapping'], params);
    if (process.env.TEXEL_LIGHTING_SHOTS) {
      const rgb = (rgba: Uint8Array) => rgba.filter((_, i) => i % 4 !== 3);
      writePng(`output/shots/texel-lighting-grid.png`, WIDTH, HEIGHT, rgb(grid));
      writePng(`output/shots/texel-lighting-${bands}-snapped.png`, WIDTH, HEIGHT, rgb(snapped));
      writePng(`output/shots/texel-lighting-${bands}-per-pixel.png`, WIDTH, HEIGHT, rgb(perPixel));
    }
    const on = splitTexels(grid, snapped);
    const off = splitTexels(grid, perPixel);
    console.log(
      `texel-lighting (${name}): ${on.pairs} same-texel pairs; split ${on.split} snapped, ${off.split} per pixel`,
    );
    expect(on.pairs).toBeGreaterThan(10_000);
    expect(off.split).toBeGreaterThan(perPixelAtLeast);
    expect(on.split).toBeLessThan(off.split / 20);
  });
});
