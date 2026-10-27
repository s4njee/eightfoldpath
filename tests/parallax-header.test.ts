import { describe, expect, it } from 'vitest';
import {
  blurMix,
  createDrift,
  focusParallax,
  LAYERS,
  layerOrigin,
  layerSigma,
  pixelsPerTexel,
  wrap,
} from '../src/effects/parallax-header/depth.ts';
import { packTextureArray } from '../src/gpu/assets.ts';
import { createLayerDof, layerDofTaps, MAX_LAYER_SIGMA } from '../src/gpu/lens/layer-dof.ts';
import { shaftDecay } from '../src/gpu/lens/shafts-screen.ts';
import { expectValid, getTestDevice, readTexture } from './gpu.ts';

describe('parallax header depth', () => {
  it('wraps offsets into one period, negative ones included', () => {
    expect(wrap(0, 120)).toBe(0);
    expect(wrap(121.5, 120)).toBeCloseTo(1.5, 12);
    expect(wrap(-0.25, 120)).toBeCloseTo(119.75, 12);
    expect(wrap(-240, 120)).toBe(0);
    expect(Object.is(wrap(-120, 120), -0)).toBe(false);
    // A long drift stays exact enough to place texels: an hour at 12 texels a second.
    expect(wrap(12 * 3600 + 0.5, 137)).toBeCloseTo((12 * 3600 + 0.5) % 137, 9);
  });

  it('orders the layers far to near, with the sky at infinity', () => {
    const parallaxes = LAYERS.map((layer) => layer.parallax);
    expect(parallaxes[0]).toBe(0);
    expect(parallaxes.at(-1)).toBe(1);
    expect([...parallaxes].sort((a, b) => a - b)).toEqual(parallaxes);
  });

  it('racks focus through the layers in parallax', () => {
    const parallaxes = [0, 0.1, 0.4, 1];
    expect(focusParallax(0, parallaxes)).toBe(0);
    expect(focusParallax(2, parallaxes)).toBe(0.4);
    expect(focusParallax(2.5, parallaxes)).toBeCloseTo(0.7, 12);
    expect(focusParallax(3, parallaxes)).toBe(1);
    expect(focusParallax(-1, parallaxes)).toBe(0);
    expect(focusParallax(9, parallaxes)).toBe(1);
  });

  it('blurs each layer by its distance from the focus in parallax, as a thin lens does', () => {
    expect(layerSigma(0.55, 0.55, 2)).toBe(0);
    expect(layerSigma(0, 0.5, 2)).toBe(1);
    expect(layerSigma(1, 0.5, 2)).toBe(1);
    expect(layerSigma(1, 0.5, -1)).toBe(0);
    // Halfway in 1/z between two layers, both are equally out of focus.
    expect(layerSigma(0.3, 0.425, 3)).toBeCloseTo(layerSigma(0.55, 0.425, 3), 12);
  });

  it('crossfades into the blurred copy for small blurs', () => {
    expect(blurMix(0)).toBe(0);
    expect(blurMix(0.125)).toBe(0.5);
    expect(blurMix(0.25)).toBe(1);
    expect(blurMix(4)).toBe(1);
  });

  it('fits the art to the height, or to the width on a portrait canvas', () => {
    expect(pixelsPerTexel(1920, 640, 64, 96)).toBe(10);
    expect(pixelsPerTexel(960, 1600, 64, 96)).toBe(10);
  });

  it('places a layer so its bottom row sits where asked', () => {
    // 10 px a texel, a 100 px canvas: 10 texels tall. A 120 x 66 layer with its bottom 2 texels
    // above the view's bottom: pixel row y = 75 is 2.5 texels up, half a texel into the art's
    // bottom row (65); the bottom pixel row is below the art (the sampler clamps it to row 65).
    const [ox, oy] = layerOrigin([120, 66], 2, -3, 0, 100, 10);
    expect(ox).toBe(117);
    expect(75 / 10 + oy).toBeCloseTo(65.5, 12);
    expect(99.5 / 10 + oy).toBeCloseTo(67.95, 12);
    // Lifted by a texel, every pixel reads one row further down the art.
    const [, lifted] = layerOrigin([120, 66], 2, -3, 1, 100, 10);
    expect(lifted - oy).toBe(1);
  });

  it('drifts with the clock and carries on from where it was when the speed changes', () => {
    const drift = createDrift();
    expect(drift(2, 3)).toBe(6);
    expect(drift(2, 3)).toBe(6);
    // The new speed applies from the frame that sees it: at 3 a second until t = 4, then 1.
    expect(drift(4, 1)).toBe(12);
    expect(drift(5, 1)).toBe(13);
    expect(drift(5, 0)).toBe(13);
  });
});

describe('screen shafts', () => {
  it('decays to the falloff at the last sample', () => {
    const decay = shaftDecay(0.25, 144);
    expect(decay ** 143).toBeCloseTo(0.25, 9);
    expect(shaftDecay(1, 144)).toBe(1);
  });
});

/** sRGB-encoded byte to linear. */
const linear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

describe('layer depth of field', () => {
  it('reads about three sigma of texels each side', () => {
    expect(layerDofTaps(0)).toBe(1);
    expect(layerDofTaps(1)).toBe(4);
    expect(layerDofTaps(1000)).toBe(3 * MAX_LAYER_SIGMA + 1);
  });

  it('blurs premultiplied, wraps across the seam and keeps the blocks at sigma zero', async () => {
    const device = await getTestDevice();
    // 8 x 4 texels: column 0 opaque white, the rest transparent but red, which a straight-alpha
    // blur would bleed into the edge.
    const [width, height, supersample] = [8, 4, 4];
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      data.set(i % width === 0 ? [255, 255, 255, 255] : [255, 0, 0, 0], i * 4);
    }
    const art = packTextureArray(device, [{ width, height, data }], 'dof test');
    const blur = createLayerDof(device, { view: art.view, width, height }, { supersample });
    const read = async (sigma: number) => {
      await expectValid(device, () => {
        const encoder = device.createCommandEncoder();
        expect(blur.update(encoder, sigma)).toBe(true);
        expect(blur.update(encoder, sigma)).toBe(false);
        device.queue.submit([encoder.finish()]);
      });
      const bytes = await readTexture(device, blur.texture);
      const w = width * supersample;
      // One row of (alpha, linear red, linear green); every row should be the same.
      const row = (y: number) =>
        Array.from({ length: w }, (_, x) => {
          const i = (y * w + x) * 4;
          return [bytes[i + 3]! / 255, linear(bytes[i]!), linear(bytes[i + 1]!)] as const;
        });
      return { rows: Array.from({ length: height * supersample }, (_, y) => row(y)), w };
    };

    const sharp = await read(0);
    const alphas = sharp.rows[0]!.map(([a]) => a);
    expect(alphas).toEqual(alphas.map((_, x) => (x < supersample ? 1 : 0)));

    const soft = await read(1);
    for (const row of soft.rows) expect(row).toEqual(soft.rows[0]);
    const profile = soft.rows[0]!;
    // The column's mass is kept: one texel of alpha in total.
    const mass = profile.reduce((sum, [a]) => sum + a, 0) / supersample;
    expect(mass).toBeCloseTo(1, 1);
    // Symmetric about the column's centre (texel 0.5), which needs the blur to wrap: output x
    // mirrors to (supersample - 1 - x) mod w.
    for (let x = 0; x < soft.w; x++) {
      const mirror = (((supersample - 1 - x) % soft.w) + soft.w) % soft.w;
      expect(Math.abs(profile[x]![0] - profile[mirror]![0])).toBeLessThanOrEqual(1 / 255);
    }
    expect(profile[soft.w - 1]![0]).toBeGreaterThan(0.1);
    // Premultiplied white: red equals green everywhere, so none of the transparent red leaked in.
    for (const [, red, green] of profile) expect(Math.abs(red - green)).toBeLessThan(0.01);

    blur.destroy();
    art.texture.destroy();
  });
});
