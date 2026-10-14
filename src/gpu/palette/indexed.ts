import type { Pixels } from '../assets.ts';
import { nearestIndex, rgb8ToHex, rgb8ToOklab, type Rgb8 } from './oklab.ts';

/*
 * Indexed-colour images for palette cycling (story 3.6).
 *
 * A 16-bit console stored a background as palette indices and changed the palette, not the
 * pixels: rotate the colours of a few entries and every pixel that uses them moves at once, so a
 * waterfall flows or lava churns for the cost of rewriting a handful of colour registers. Here the
 * art is converted to indices at load: each texel becomes the index of the nearest colour (in
 * OKLab) of a small palette built from the image itself, and the colours to cycle are placed first
 * and contiguous so that a cycling range is just a start and a length.
 */

/** Index of a fully transparent texel. */
export const TRANSPARENT_INDEX = 255;

export interface IndexedImage {
  readonly width: number;
  readonly height: number;
  /** One byte per texel, row by row; `TRANSPARENT_INDEX` where alpha is 0. */
  readonly indices: Uint8Array;
  /** At most 255 colours. */
  readonly palette: readonly Rgb8[];
}

export interface IndexOptions {
  /** Colours placed first, in this order, whether or not the image uses them. */
  leading?: readonly Rgb8[];
  /** Largest palette to build; the least used colours beyond it map to their nearest neighbour. */
  maxColours?: number;
}

const key = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b;

export function indexImage(pixels: Pixels, options: IndexOptions = {}): IndexedImage {
  const { width, height, data } = pixels;
  const maxColours = Math.min(255, options.maxColours ?? 64);
  const leading = options.leading ?? [];

  const counts = new Map<number, number>();
  for (let p = 0; p < data.length; p += 4) {
    if (data[p + 3]! < 128) continue;
    const k = key(data[p]!, data[p + 1]!, data[p + 2]!);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const leadingKeys = leading.map(([r, g, b]) => key(r, g, b));
  // The rest by use, most used first, cut to fit; then ordered dark to light so the index view
  // reads as a ramp.
  const rest = [...counts.entries()]
    .filter(([k]) => !leadingKeys.includes(k))
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(0, maxColours - leading.length))
    .map(([k]) => [(k >> 16) & 255, (k >> 8) & 255, k & 255] as const)
    .sort((a, b) => rgb8ToOklab(a)[0] - rgb8ToOklab(b)[0]);
  const palette: Rgb8[] = [...leading, ...rest];
  const labs = palette.map(rgb8ToOklab);
  const exact = new Map(palette.map(([r, g, b], i) => [key(r, g, b), i]));

  const indices = new Uint8Array(width * height);
  for (let i = 0; i < indices.length; i++) {
    const p = i * 4;
    if (data[p + 3]! < 128) {
      indices[i] = TRANSPARENT_INDEX;
      continue;
    }
    const k = key(data[p]!, data[p + 1]!, data[p + 2]!);
    indices[i] =
      exact.get(k) ?? nearestIndex(rgb8ToOklab([data[p]!, data[p + 1]!, data[p + 2]!]), labs);
  }
  return { width, height, indices, palette };
}

/** A run of palette entries that rotate together. */
export interface CycleRange {
  readonly start: number;
  readonly length: number;
}

/**
 * The entry an index shows after the range has rotated `shift` steps: the CPU twin of
 * `palette_cycle_index` in `src/wgsl/palette.wgsl`. Positive shifts move colours towards higher
 * indices, which in a dark-to-light ramp makes bands travel from dark towards light.
 */
export function cycleIndex(index: number, range: CycleRange, shift: number): number {
  if (index < range.start || index >= range.start + range.length) return index;
  const offset = index - range.start - Math.floor(shift);
  return range.start + (((offset % range.length) + range.length) % range.length);
}

/** Colours that appear in the image, as hex, for messages and tests. */
export function usedColours(image: IndexedImage): string[] {
  const used = new Set<number>();
  for (const index of image.indices) if (index !== TRANSPARENT_INDEX) used.add(index);
  return [...used].sort((a, b) => a - b).map((i) => rgb8ToHex(image.palette[i]!));
}
