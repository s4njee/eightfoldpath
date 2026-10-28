/*
 * Lit sprites (story 3.3): the pieces an effect needs to give the sprite batcher a lighting shade.
 *
 *   const shade = spriteLightShade(myShadeWgsl);   // sprite-light.wgsl helpers + your sprite_shade
 *   createSpriteBatch(device, { sheets, normals, shade, shadeLayout, ... });
 *
 * The helpers in src/wgsl/sprite-light.wgsl read the batcher's normal map in the quad's own frame;
 * those in src/wgsl/sprite-light-common.wgsl attenuate point lights to a range, add a rim and
 * quantise light into bands. Both are pasted in front of the effect's chunk because the batcher
 * compiles its shade from a string. A fullscreen pass can `#include "sprite-light-common.wgsl"`.
 */
import type { Pixels } from '../assets.ts';
import common from '../../wgsl/sprite-light-common.wgsl?raw';
import helpers from '../../wgsl/sprite-light.wgsl?raw';

export { distanceToEdge, flatNormals, heightFromAlpha, normalsFromAlpha } from './normals.ts';

/** A shade chunk for `createSpriteBatch`: the lighting helpers, then `body`. */
export function spriteLightShade(body: string): string {
  return `${common}\n${helpers}\n${body}`;
}

const srgbToLinear = (byte: number) => {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** OKLab from linear sRGB (Ottosson 2020); the same transform as `sprite_light_oklab`. */
export function oklab(rgb: readonly [number, number, number]): [number, number, number] {
  const [r, g, b] = rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export interface Palette {
  /** Linear RGB, one entry per distinct opaque colour, in image order. */
  readonly linear: readonly (readonly [number, number, number])[];
  /** The same colours in OKLab. */
  readonly lab: readonly (readonly [number, number, number])[];
}

/** The distinct opaque colours of a palette image (assets/palette/eightfold.png is 48 × 1). */
export function paletteFromPixels(pixels: Pixels): Palette {
  const seen = new Set<number>();
  const linear: [number, number, number][] = [];
  for (let i = 0; i < pixels.width * pixels.height; i++) {
    const [r, g, b, a] = pixels.data.subarray(i * 4, i * 4 + 4);
    if (a! < 128) continue;
    const key = (r! << 16) | (g! << 8) | b!;
    if (seen.has(key)) continue;
    seen.add(key);
    linear.push([srgbToLinear(r!), srgbToLinear(g!), srgbToLinear(b!)]);
  }
  return { linear, lab: linear.map(oklab) };
}
