import { createTextureFromData } from '../texture.ts';
import {
  linearToOklab,
  nearestIndex,
  oklabToLinear,
  rgb8ToOklab,
  type Rgb8,
  type Vec3,
} from './oklab.ts';

/*
 * Palette ramps for shading (story 3.5, used again by sprite lighting in 3.3).
 *
 * A pixel artist shades a material with a short ramp of palette colours, dark to light, rather
 * than by darkening the base colour: the shadows lean cool and the highlights warm, and every step
 * is a colour that exists in the palette. Lighting can do the same by turning its light level into
 * a step on the ramp instead of multiplying the colour.
 *
 * `buildRamp` derives a ramp from one base colour: it walks OKLab lightness from dark to light at
 * the base colour's hue, lets the chroma fall off towards both ends, turns the hue towards blue in
 * the shadows and towards yellow in the highlights by `hueShift`, and takes the nearest palette
 * colour at each step. Steps that land on the same colour merge, so a ramp is as long as the
 * palette allows, not as long as asked.
 */

export interface RampOptions {
  /** Steps to try between darkest and lightest. Default 10. */
  steps?: number;
  /** OKLab lightness of the darkest and lightest step. Default 0.2..0.92. */
  range?: readonly [number, number];
  /** Radians the hue turns towards blue (shadows) and yellow (highlights). Default 0.35. */
  hueShift?: number;
}

const SHADOW_HUE = (265 * Math.PI) / 180;
const LIGHT_HUE = (95 * Math.PI) / 180;

/** Turns `from` towards `to` by at most `amount` radians, the short way round. */
function turn(from: number, to: number, amount: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  return from + Math.sign(delta) * Math.min(Math.abs(delta), amount);
}

/** Palette indices from dark to light, without repeats. */
export function buildRamp(
  palette: readonly Rgb8[],
  base: Rgb8,
  options: RampOptions = {},
): number[] {
  const steps = Math.max(2, options.steps ?? 10);
  const [low, high] = options.range ?? [0.2, 0.92];
  const hueShift = options.hueShift ?? 0.35;
  const labs = palette.map(rgb8ToOklab);
  const [, a, b] = rgb8ToOklab(base);
  const chroma = Math.hypot(a, b);
  const hue = Math.atan2(b, a);

  const ramp: number[] = [];
  for (let step = 0; step < steps; step++) {
    const t = step / (steps - 1);
    const L = low + (high - low) * t;
    // Strongest colour in the middle of the ramp, greyer at the dark and light ends.
    const c = chroma * (1 - 0.55 * (2 * t - 1) ** 2);
    const h =
      t < 0.5
        ? turn(hue, SHADOW_HUE, hueShift * (1 - 2 * t))
        : turn(hue, LIGHT_HUE, hueShift * (2 * t - 1));
    // Through linear RGB and back, clamped, so the target is a colour a screen can show.
    const linear = oklabToLinear([L, c * Math.cos(h), c * Math.sin(h)]).map((v) =>
      Math.min(1, Math.max(0, v)),
    ) as unknown as Vec3;
    const index = nearestIndex(linearToOklab(linear), labs);
    if (!ramp.includes(index)) ramp.push(index);
  }
  // Nearest-colour picks can come back slightly out of order; a ramp must only get lighter.
  return ramp.sort((i, j) => labs[i]![0] - labs[j]![0]);
}

/** `ramp` stretched or squeezed to exactly `length` entries, keeping its ends. */
export function resampleRamp(ramp: readonly number[], length: number): number[] {
  return Array.from(
    { length },
    (_, i) => ramp[Math.round((i * (ramp.length - 1)) / Math.max(1, length - 1))]!,
  );
}

/**
 * Ramps as rows of an `rgba8unorm-srgb` texture, `length` texels wide: row `r`, column `k` is step
 * `k` of ramp `r`. A shader quantises its light level to a column and loads the colour.
 */
export function createRampTexture(
  device: GPUDevice,
  palette: readonly Rgb8[],
  ramps: readonly (readonly number[])[],
  length: number,
): GPUTexture {
  const data = new Uint8Array(length * ramps.length * 4);
  ramps.forEach((ramp, row) => {
    resampleRamp(ramp, length).forEach((index, column) => {
      const colour = palette[index]!;
      data.set([colour[0], colour[1], colour[2], index], (row * length + column) * 4);
    });
  });
  return createTextureFromData(device, {
    label: 'palette ramps',
    width: length,
    height: ramps.length,
    format: 'rgba8unorm-srgb',
    data,
  });
}
