/*
 * The maths of the pixelate hover (story 9.3): which block sizes the transition steps through, how
 * the hover is eased, and how big a block is in the picture's own texels so it stays put.
 */

/** How the block size grows: one CSS pixel at a time, or doubling (each step nests in the next). */
export const STEP_MODES = ['linear', 'doubling'] as const;
export type StepMode = (typeof STEP_MODES)[number];

/**
 * The block sizes the transition passes through, in CSS pixels, smallest first and ending at
 * `largest`. `linear` is the old console mosaic (1, 2, 3 … n). `doubling` (1, 2, 4 … then n) has
 * fewer, bigger steps, and every block of one step is cut exactly into blocks of the step before,
 * because the grids share an anchor; the picture subdivides instead of reshuffling.
 */
export function blockSteps(largest: number, mode: StepMode): number[] {
  const top = Math.max(1, Math.round(largest));
  if (mode === 'linear') return Array.from({ length: top }, (_, i) => i + 1);
  const steps: number[] = [];
  for (let size = 1; size < top; size *= 2) steps.push(size);
  steps.push(top);
  return steps;
}

/**
 * Which state a pixel amount `p` shows: 0 is full detail, `i` (1 … count) is the `i`th block size.
 * Every state gets the same share of the transition, so the steps keep an even beat.
 */
export function stateAt(p: number, count: number): number {
  const t = Math.min(Math.max(p, 0), 1);
  return Math.min(count, Math.floor(t * (count + 1)));
}

/** A block size in CSS pixels as whole device pixels (at least one). */
export function devicePixels(css: number, dpr: number): number {
  return Math.max(1, Math.round(css * dpr));
}

/**
 * Moves `value` toward `target` at `1 / duration` a second: a tween of fixed length rather than
 * an exponential approach, so it arrives, and the last step is not left hanging. A duration of 0
 * snaps.
 */
export function stepToward(value: number, target: number, delta: number, duration: number): number {
  if (duration <= 0) return target;
  // A hair extra, so a run of frames that should sum to the duration exactly is not left a
  // rounding error short of the end.
  const step = Math.max(delta, 0) / duration + (delta > 0 ? 1e-9 : 0);
  return value < target ? Math.min(target, value + step) : Math.max(target, value - step);
}

/** Cubic ease in and out: slow off the mark, slow into the end. */
export function easeInOut(t: number): number {
  const x = Math.min(Math.max(t, 0), 1);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

/** Which way the hover goes: `reveal` is pixel art at rest and detail on hover; `pixelate` the reverse. */
export const DIRECTIONS = ['reveal', 'pixelate'] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** How much pixel art to show (0 detail, 1 pixel art) for an eased hover amount `h`, 0..1. */
export function pixelAmount(h: number, direction: Direction): number {
  return direction === 'reveal' ? 1 - h : h;
}

/**
 * Device pixels per texel of a `picture` covering a `width` × `height` canvas (cropping the longer
 * side), before any hover zoom.
 */
export function coverScale(width: number, height: number, picture: readonly [number, number]) {
  return Math.max(width / picture[0], height / picture[1]);
}

/**
 * A block's size in the picture's texels. Blocks live in the picture, anchored at its centre, so a
 * hover zoom scales them with it instead of letting the picture slide under a fixed grid. They are
 * sized so that at the pixel-art end of the transition (`zoomAtPixelArt`, the zoom there) a block
 * is exactly `pixels` device pixels: the resting pixel art is crisp, and only the moving frames
 * between have uneven blocks.
 */
export function blockTexels(pixels: number, scale: number, zoomAtPixelArt: number): number {
  return pixels / (scale * (1 + zoomAtPixelArt));
}
