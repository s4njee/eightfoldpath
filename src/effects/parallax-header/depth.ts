/*
 * The parallax header's camera as plain numbers (story 9.4), kept apart from the GPU code so the
 * tests can check it.
 *
 * Every layer is a flat picture at some distance z from the camera. A pinhole camera that moves
 * sideways by d shifts a plane at distance z by d / z on screen, so each layer is described by its
 * parallax p = z_near / z: 1 for the nearest layer, 0 for the sky at infinity. A thin lens focused
 * at z_f blurs a plane at z into a circle of confusion proportional to |1/z - 1/z_f|, which is
 * |p - p_f| in the same units, so the one number per layer drives both the motion and the blur.
 */

/** One picture of the header, far to near. */
export interface LayerSpec {
  readonly name: string;
  /** z_near / z: how far the layer moves with the camera, 1 for the nearest, 0 for infinity. */
  readonly parallax: number;
  /** Where the layer's bottom edge sits, in texels above the bottom of the view. */
  readonly bottom: number;
}

/**
 * The five layers in assets/parallax. Their heights differ (51 to 76 texels) and so do their
 * empty tops, so each sits at its own height: the mountains' peaks stand above the hills and the
 * treeline, the sky's orange band shows between the peaks, and the foreground grass hangs below
 * the view (its bottom rows are transparent).
 */
export const LAYERS: readonly LayerSpec[] = [
  { name: 'sky', parallax: 0, bottom: 29 },
  { name: 'mountains', parallax: 0.12, bottom: 6 },
  { name: 'hills', parallax: 0.3, bottom: -14 },
  { name: 'treeline', parallax: 0.55, bottom: -20 },
  { name: 'foreground', parallax: 1, bottom: -19 },
];

/** `x` wrapped into [0, period), for a layer that tiles horizontally; never returns -0. */
export function wrap(x: number, period: number): number {
  const r = x % period;
  return r < 0 ? r + period : r + 0;
}

/**
 * The parallax in focus for a focus control running from 0 (the farthest layer) to
 * `parallaxes.length - 1` (the nearest), interpolated linearly between neighbouring layers so the
 * focus can be racked smoothly through them.
 */
export function focusParallax(focus: number, parallaxes: readonly number[]): number {
  const last = parallaxes.length - 1;
  const at = Math.min(Math.max(focus, 0), last);
  const i = Math.min(Math.floor(at), last - 1);
  const t = at - i;
  return parallaxes[i]! * (1 - t) + parallaxes[i + 1]! * t;
}

/**
 * A flat layer's blur, as the standard deviation of a Gaussian in texels: the thin-lens circle of
 * confusion |p - p_f| times the aperture. Constant over the whole layer, which is what lets the
 * blur be done once per layer instead of once per pixel.
 */
export function layerSigma(parallax: number, focus: number, aperture: number): number {
  return Math.max(aperture, 0) * Math.abs(parallax - focus);
}

/**
 * How much of the pre-blurred copy to show instead of the sharp layer. The blurred copy is stored
 * at a few times the art's resolution, so a blur smaller than about one of its pixels cannot be
 * told from the bilinear ramp; below `full` texels the two are crossfaded, so racking focus
 * eases into the blur instead of stepping.
 */
export function blurMix(sigma: number, full = 0.25): number {
  return Math.min(Math.max(sigma / full, 0), 1);
}

/**
 * A position that moves at `speed` units a second as a function of the clock, rather than summed
 * frame by frame, so a frame drawn twice at the same time (the before/after split, a still frame)
 * lands in the same place; when the speed changes, the position carries on from where it was.
 */
export function createDrift(): (time: number, speed: number) => number {
  let base = 0;
  let rate: number | undefined;
  return (time, speed) => {
    if (rate === undefined) rate = speed;
    else if (speed !== rate) {
      base += (rate - speed) * time;
      rate = speed;
    }
    return base + rate * time;
  };
}

/**
 * Screen pixels per art texel: `viewTexels` rows of art fill the canvas height, unless that would
 * leave fewer than `minWideTexels` across (a portrait phone), in which case the width decides and
 * the view grows taller, showing more sky instead of a magnified crop of the middle.
 */
export function pixelsPerTexel(
  canvasWidth: number,
  canvasHeight: number,
  viewTexels: number,
  minWideTexels: number,
): number {
  return Math.min(
    Math.max(canvasHeight, 1) / Math.max(viewTexels, 1),
    Math.max(canvasWidth, 1) / Math.max(minWideTexels, 1),
  );
}

/**
 * Where a layer is drawn: the texel under framebuffer pixel `(px, py)` (top-left origin) is
 * `(px, py) / scale + origin`. `x` is how far the camera has moved, in texels of the nearest
 * layer, and `y` how far the layer has moved up; both are scaled by the caller.
 */
export function layerOrigin(
  size: readonly [number, number],
  bottom: number,
  x: number,
  y: number,
  canvasHeight: number,
  scale: number,
): [number, number] {
  // Row 0 is the image's top; its bottom row ends `bottom + y` texels above the view's bottom.
  return [wrap(x, size[0]), size[1] + bottom + y - canvasHeight / scale];
}
