import {
  buildRamp,
  linearToOklab,
  rgb8ToLinear,
  rgb8ToOklab,
  type Rgb8,
} from '../../gpu/palette/index.ts';
import { createTextureFromData } from '../../gpu/texture.ts';

/*
 * Palette shading for the pointer-lit sprite: what each palette colour becomes under a light level,
 * as a palette colour. Story 3.5 found that lit content keeps its colours best when the light
 * picks a step of a ramp of palette colours rather than lighting the colour and searching the
 * palette (which turns lit skin and dark cloth grey). Here every palette colour gets its own ramp
 * (`buildRamp`, with the colour itself put back in, so an unlit-but-not-darkened texel keeps the
 * colour it was painted), and the table records, for each light level, the step whose OKLab
 * lightness is nearest the lit colour's.
 *
 * Rows are palette indices, columns light levels from 0 to `MAX_GAIN` in `SHADE_LEVELS` steps, so
 * gain 1 (lit exactly as painted) is the middle column. The shader finds a texel's row from the
 * lookup table's index channel and its column from the light: one texture read.
 */

export const SHADE_LEVELS = 17;
export const MAX_GAIN = 2;

/** The column of `gain` (rounded), clamped to the table. */
export function shadeColumn(gain: number, levels = SHADE_LEVELS, maxGain = MAX_GAIN): number {
  const t = Math.min(Math.max(gain / maxGain, 0), 1);
  return Math.round(t * (levels - 1));
}

/** Palette indices, `levels` per palette colour, row by row. */
export function buildShadeTable(
  palette: readonly Rgb8[],
  levels = SHADE_LEVELS,
  maxGain = MAX_GAIN,
): Uint8Array {
  const labs = palette.map(rgb8ToOklab);
  const table = new Uint8Array(palette.length * levels);
  palette.forEach((colour, row) => {
    const ramp = buildRamp(palette, colour);
    if (!ramp.includes(row)) ramp.push(row);
    const linear = rgb8ToLinear(colour);
    for (let column = 0; column < levels; column++) {
      const gain = (column / (levels - 1)) * maxGain;
      const target = linearToOklab([linear[0] * gain, linear[1] * gain, linear[2] * gain])[0];
      let best = row;
      let bestDistance = Infinity;
      for (const index of ramp) {
        const d = Math.abs(labs[index]![0] - target);
        // Ties go to the painted colour, so gain 1 always returns it.
        if (d < bestDistance || (d === bestDistance && index === row)) {
          best = index;
          bestDistance = d;
        }
      }
      table[row * levels + column] = best;
    }
  });
  return table;
}

/** The table as an `rgba8unorm-srgb` texture: `levels` wide, one row per palette colour. */
export function createShadeTexture(device: GPUDevice, palette: readonly Rgb8[]): GPUTexture {
  const table = buildShadeTable(palette);
  const data = new Uint8Array(table.length * 4);
  table.forEach((index, i) => {
    const colour = palette[index]!;
    data.set([colour[0], colour[1], colour[2], index], i * 4);
  });
  return createTextureFromData(device, {
    label: 'pointer-lit-sprite shade table',
    width: SHADE_LEVELS,
    height: palette.length,
    format: 'rgba8unorm-srgb',
    data,
  });
}
