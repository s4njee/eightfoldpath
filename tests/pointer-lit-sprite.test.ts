import { describe, expect, it } from 'vitest';
import {
  easeFactor,
  fitPortrait,
  frameToTexel,
  idleLight,
  pointerTarget,
  reachInto,
  toFrame,
} from '../src/effects/pointer-lit-sprite/light.ts';
import {
  buildShadeTable,
  MAX_GAIN,
  SHADE_LEVELS,
  shadeColumn,
} from '../src/effects/pointer-lit-sprite/shade-table.ts';
import { EIGHTFOLD, rgb8ToOklab } from '../src/gpu/palette/index.ts';
import { mountHeadless } from './headless.ts';

/** A pointer event on a headless canvas; `x`, `y` are 0..1 across it. */
function point(
  canvas: HTMLCanvasElement,
  type: string,
  x: number,
  y: number,
  pointerType = 'mouse',
) {
  const event = new Event(type);
  const props = {
    pointerId: 1,
    pointerType,
    clientX: x * canvas.width,
    clientY: y * canvas.height,
  };
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(event, key, { value, configurable: true });
  }
  canvas.dispatchEvent(event);
}

/** Mean of the red, green and blue bytes over columns [from, to) of an RGBA picture. */
function brightness(rgba: Uint8Array, width: number, from: number, to: number): number {
  let sum = 0;
  let count = 0;
  for (let p = 0; p < rgba.length; p += 4) {
    const x = (p / 4) % width;
    if (x < from || x >= to) continue;
    sum += rgba[p]! + rgba[p + 1]! + rgba[p + 2]!;
    count += 3;
  }
  return sum / count;
}

describe('pointer-lit sprite light', () => {
  it('eases by the elapsed time, so a still frame leaves the light alone', () => {
    expect(easeFactor(0, 7)).toBe(0);
    expect(easeFactor(-1, 7)).toBe(0);
    expect(easeFactor(Math.LN2 / 7, 7)).toBeCloseTo(0.5, 12);
    expect(easeFactor(10, 7)).toBeCloseTo(1, 12);
    // Two half-frames cover what one whole frame does: the frame rate does not change the speed.
    const half = easeFactor(1 / 120, 7);
    expect(1 - (1 - half) ** 2).toBeCloseTo(easeFactor(1 / 60, 7), 12);
  });

  it('puts the light under the pointer inside the frame and pulls it in beyond', () => {
    for (const d of [-1, -0.4, 0, 0.7, 1]) expect(reachInto(d, 1)).toBe(d);
    // Continuous at the edge, still moving outward, never past 1 + reach.
    expect(reachInto(1.0001, 1)).toBeCloseTo(1.0001, 6);
    expect(reachInto(3, 1)).toBeGreaterThan(reachInto(2, 1));
    expect(reachInto(1000, 1)).toBeLessThanOrEqual(2);
    expect(reachInto(1000, 0.5)).toBeCloseTo(1.5, 9);
    expect(reachInto(-5, 1)).toBe(-reachInto(5, 1));
    expect(reachInto(4, 0)).toBe(1);
  });

  it('fits the portrait in the disc: centred, at its fill, resting on the disc’s foot', () => {
    const bust = fitPortrait(200, 200, [47, 53], { fill: 0.86, bottom: 1 });
    expect(bust.radius).toBe(99);
    expect(bust.centre).toEqual([100, 100]);
    expect(bust.scale * 53).toBeCloseTo(0.86 * 198, 9);
    expect(bust.origin[0] + (47 * bust.scale) / 2).toBeCloseTo(100, 9);
    expect(bust.origin[1] + 53 * bust.scale).toBeCloseTo(199, 9);
    // A wide canvas uses its height; a sprite wider than tall is held by the disc's width.
    expect(fitPortrait(600, 200, [47, 53], { fill: 0.86, bottom: 1 }).scale).toBe(bust.scale);
    const wide = fitPortrait(200, 200, [120, 66], { fill: 0.86, bottom: 1 });
    expect(wide.scale * 120).toBeCloseTo(1.9 * 99, 9);
  });

  it('maps the pointer to frame units and on into the sprite’s texels', () => {
    const fit = fitPortrait(300, 200, [47, 53], { fill: 0.86, bottom: 1 });
    expect(toFrame([0.5, 0.5], 300, 200, fit)).toEqual([0, 0]);
    // The disc's right edge is one radius from the centre.
    expect(toFrame([(150 + 99) / 300, 0.5], 300, 200, fit)[0]).toBeCloseTo(1, 12);
    // A pointer over a canvas pixel lights the texel under that pixel.
    const pixel = [130, 70] as const;
    const texel = frameToTexel(toFrame([pixel[0] / 300, pixel[1] / 200], 300, 200, fit), fit);
    expect(texel[0]).toBeCloseTo((pixel[0] - fit.origin[0]) / fit.scale, 9);
    expect(texel[1]).toBeCloseTo((pixel[1] - fit.origin[1]) / fit.scale, 9);
    // From the far corner of a page, the light stays within reach of the portrait.
    const far = pointerTarget([-8, 6], 300, 200, fit, 1);
    expect(far[0]).toBeLessThan(-1);
    expect(far[0]).toBeGreaterThanOrEqual(-2);
    expect(far[1]).toBeGreaterThan(1);
  });

  it('idles above the face and swings to both sides', () => {
    const path = Array.from({ length: 400 }, (_, i) => idleLight(i * 0.1, 0.45));
    expect(Math.max(...path.map((p) => p[1]))).toBeLessThan(0);
    expect(Math.max(...path.map((p) => p[0]))).toBeGreaterThan(0.8);
    expect(Math.min(...path.map((p) => p[0]))).toBeLessThan(-0.8);
  });
});

describe('pointer-lit sprite palette shading', () => {
  const table = buildShadeTable(EIGHTFOLD);
  const lightness = EIGHTFOLD.map((colour) => rgb8ToOklab(colour)[0]);

  it('keeps every colour as painted at gain 1, the middle column', () => {
    expect(shadeColumn(1)).toBe((SHADE_LEVELS - 1) / 2);
    expect(shadeColumn(-1)).toBe(0);
    expect(shadeColumn(MAX_GAIN * 3)).toBe(SHADE_LEVELS - 1);
    EIGHTFOLD.forEach((_, row) => expect(table[row * SHADE_LEVELS + shadeColumn(1)]).toBe(row));
  });

  it('only gets lighter as the light rises', () => {
    EIGHTFOLD.forEach((_, row) => {
      for (let column = 1; column < SHADE_LEVELS; column++) {
        const before = lightness[table[row * SHADE_LEVELS + column - 1]!]!;
        expect(lightness[table[row * SHADE_LEVELS + column]!]!).toBeGreaterThanOrEqual(before);
      }
    });
  });
});

describe('pointer-lit sprite on the GPU', () => {
  const WIDTH = 160;
  const HEIGHT = 160;

  it('lights the side the pointer is on, and holds still on a frame with no time', async () => {
    const left = await mountHeadless('pointer-lit-sprite', { width: WIDTH, height: HEIGHT });
    const right = await mountHeadless('pointer-lit-sprite', { width: WIDTH, height: HEIGHT });
    point(left.canvas, 'pointerenter', 0.1, 0.35);
    point(right.canvas, 'pointerenter', 0.9, 0.35);
    await left.runTo(1);
    await right.runTo(1);
    const a = await left.read();
    const b = await right.read();
    const half = WIDTH / 2;
    expect(brightness(a, WIDTH, 0, half)).toBeGreaterThan(brightness(a, WIDTH, half, WIDTH));
    expect(brightness(b, WIDTH, half, WIDTH)).toBeGreaterThan(brightness(b, WIDTH, 0, half));

    // Reduced motion: the host draws frames with no elapsed time, and the light does not move
    // even though the pointer has.
    point(left.canvas, 'pointermove', 0.9, 0.35);
    const encoder = left.device.createCommandEncoder();
    left.instance.frame(
      { time: left.time.time, delta: 0, frame: 0 },
      encoder,
      left.target.createView(),
    );
    left.device.queue.submit([encoder.finish()]);
    expect(Buffer.from(await left.read()).equals(Buffer.from(a))).toBe(true);
    left.destroy();
    right.destroy();
  });

  it('keeps the corners outside the disc transparent', async () => {
    const mounted = await mountHeadless('pointer-lit-sprite', { width: WIDTH, height: HEIGHT });
    await mounted.runTo(0.1);
    const rgba = await mounted.read();
    expect(rgba[3]).toBe(0);
    expect(rgba[(HEIGHT / 2) * WIDTH * 4 + (WIDTH / 2) * 4 + 3]).toBe(255);
    mounted.destroy();
  });
});
