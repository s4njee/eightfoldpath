import { describe, expect, it } from 'vitest';
import {
  blockSteps,
  blockTexels,
  coverScale,
  devicePixels,
  easeInOut,
  pixelAmount,
  stateAt,
  stepToward,
} from '../src/effects/pixelate-hover/steps.ts';
import { EIGHTFOLD } from '../src/gpu/palette/index.ts';
import { mountHeadless } from './headless.ts';

const PALETTE = new Set(EIGHTFOLD.map(([r, g, b]) => (r << 16) | (g << 8) | b));

function paletteShare(rgba: Uint8Array): number {
  let inside = 0;
  for (let p = 0; p < rgba.length; p += 4) {
    if (PALETTE.has((rgba[p]! << 16) | (rgba[p + 1]! << 8) | rgba[p + 2]!)) inside++;
  }
  return inside / (rgba.length / 4);
}

function point(canvas: HTMLCanvasElement, type: string, pointerType = 'mouse') {
  const event = new Event(type);
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  canvas.dispatchEvent(event);
}

const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

describe('pixelate hover steps', () => {
  it('grows the block one pixel at a time, or doubling up to the largest', () => {
    expect(blockSteps(5, 'linear')).toEqual([1, 2, 3, 4, 5]);
    expect(blockSteps(8, 'doubling')).toEqual([1, 2, 4, 8]);
    expect(blockSteps(6, 'doubling')).toEqual([1, 2, 4, 6]);
    expect(blockSteps(1, 'doubling')).toEqual([1]);
    expect(blockSteps(0.2, 'linear')).toEqual([1]);
    // Doubling nests: every block of a step is cut exactly into blocks of the step before.
    const steps = blockSteps(16, 'doubling');
    for (let i = 1; i < steps.length; i++) expect(steps[i]! % steps[i - 1]!).toBe(0);
  });

  it('gives every state the same share of the transition', () => {
    expect(stateAt(0, 3)).toBe(0);
    expect(stateAt(1, 3)).toBe(3);
    expect(stateAt(-1, 3)).toBe(0);
    expect(stateAt(2, 3)).toBe(3);
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 4000; i++) counts[stateAt((i + 0.5) / 4000, 3)]!++;
    expect(counts).toEqual([1000, 1000, 1000, 1000]);
  });

  it('rounds block sizes to whole device pixels', () => {
    expect(devicePixels(4, 1)).toBe(4);
    expect(devicePixels(4, 1.5)).toBe(6);
    expect(devicePixels(3, 1.25)).toBe(4);
    expect(devicePixels(1, 0.25)).toBe(1);
  });

  it('tweens the hover at a fixed rate and lands on the end', () => {
    expect(stepToward(0, 1, 0.1, 0.4)).toBeCloseTo(0.25, 6);
    expect(stepToward(0.9, 1, 0.1, 0.4)).toBe(1);
    expect(stepToward(0.1, 0, 0.1, 0.4)).toBe(0);
    expect(stepToward(0.5, 1, 0, 0.4)).toBe(0.5);
    expect(stepToward(0, 1, 0.01, 0)).toBe(1);
    let h = 0;
    for (let frame = 0; frame < 24; frame++) h = stepToward(h, 1, 1 / 60, 0.4);
    expect(h).toBe(1);
  });

  it('eases in and out symmetrically', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 12);
    expect(easeInOut(0.2) + easeInOut(0.8)).toBeCloseTo(1, 12);
    for (let i = 1; i <= 100; i++) {
      expect(easeInOut(i / 100)).toBeGreaterThanOrEqual(easeInOut((i - 1) / 100));
    }
    expect(pixelAmount(0, 'reveal')).toBe(1);
    expect(pixelAmount(0, 'pixelate')).toBe(0);
  });

  it('sizes blocks in the picture so the pixel-art end is whole device pixels', () => {
    const scale = coverScale(400, 300, [1376, 768]);
    expect(scale).toBeCloseTo(300 / 768, 12);
    // Reveal: the pixel art rests unzoomed, so a block is exactly its pixels on screen.
    expect(blockTexels(6, scale, 0) * scale).toBeCloseTo(6, 12);
    // Pixelate: the pixel art is the hovered, zoomed end; there too a block is exactly 6 pixels.
    const zoom = 0.04;
    expect(blockTexels(6, scale, zoom) * scale * (1 + zoom)).toBeCloseTo(6, 12);
  });
});

describe('pixelate hover on the GPU', () => {
  const WIDTH = 240;
  const HEIGHT = 160;

  it('rests as palette pixel art, shows the painting on hover and comes back exactly', async () => {
    const mounted = await mountHeadless('pixelate-hover', { width: WIDTH, height: HEIGHT });
    await mounted.runTo(0.2);
    const rest = await mounted.read();
    expect(paletteShare(rest)).toBe(1);

    // Each block is one flat colour: the 4 × 4 block whose corner is the canvas centre.
    const at = (x: number, y: number) =>
      rest.subarray((y * WIDTH + x) * 4, (y * WIDTH + x) * 4 + 3);
    for (let y = 80; y < 84; y++) {
      for (let x = 120; x < 124; x++) expect([...at(x, y)]).toEqual([...at(120, 80)]);
    }

    point(mounted.canvas, 'pointerenter');
    await mounted.runTo(1);
    const hovered = await mounted.read();
    expect(paletteShare(hovered)).toBeLessThan(0.2);

    point(mounted.canvas, 'pointerleave');
    await mounted.runTo(2);
    expect(same(await mounted.read(), rest)).toBe(true);
    mounted.destroy();
  });

  it('passes through each block size on the way', async () => {
    const mounted = await mountHeadless('pixelate-hover', { width: WIDTH, height: HEIGHT });
    point(mounted.canvas, 'pointerenter');
    const seen = new Set<number>();
    for (let frame = 0; frame < 40; frame++) {
      mounted.step();
      seen.add(Number(mounted.instance.stats?.().step));
    }
    // Doubling up to 4: blocks of 4, 2 and 1 pixel, then the painting.
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
    mounted.destroy();
  });

  it('toggles on a tap, which has no hover, and ignores a touch that scrolls', async () => {
    const mounted = await mountHeadless('pixelate-hover', {
      width: WIDTH,
      height: HEIGHT,
      params: { direction: 'pixelate' },
    });
    await mounted.runTo(0.1);
    const rest = await mounted.read();
    expect(paletteShare(rest)).toBeLessThan(0.2);
    point(mounted.canvas, 'pointerenter', 'touch');
    point(mounted.canvas, 'pointercancel', 'touch');
    await mounted.runTo(1);
    expect(same(await mounted.read(), rest)).toBe(true);
    point(mounted.canvas, 'pointerup', 'touch');
    await mounted.runTo(2);
    expect(paletteShare(await mounted.read())).toBe(1);
    point(mounted.canvas, 'pointerup', 'touch');
    await mounted.runTo(3);
    expect(same(await mounted.read(), rest)).toBe(true);
    mounted.destroy();
  });
});
