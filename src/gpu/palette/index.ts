import eightfoldHex from '../../../assets/palette/eightfold.hex?raw';
import { parseHexPalette, type Rgb8 } from './oklab.ts';

/*
 * Palette tools (stories 3.5 and 3.6): the nearest-colour lookup table, dither thresholds, shading
 * ramps and indexed-colour images, with `src/wgsl/palette.wgsl` as their shader side.
 *
 *   const lut = createPaletteLutTexture(device, EIGHTFOLD);   // 3D, 32³
 *   const noise = createBlueNoiseTexture(device);             // r8unorm, 64²
 *   // WGSL: #include "palette.wgsl"
 *   //   let mapped = palette_lut_lookup(lut, palette_dither(colour, threshold, strength));
 */

/** The project palette, `assets/palette/eightfold.hex`: 48 colours, dark to light. */
export const EIGHTFOLD: readonly Rgb8[] = parseHexPalette(eightfoldHex);

export * from './dither.ts';
export * from './indexed.ts';
export * from './lut.ts';
export * from './oklab.ts';
export * from './ramps.ts';
