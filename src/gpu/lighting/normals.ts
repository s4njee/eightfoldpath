/*
 * Normal maps for pixel-art sprites that have none (story 3.3; the offline tool of story 10.3).
 *
 *   const normals = normalsFromAlpha(sprite);                 // a rounded "pillow" from the alpha
 *   const painted = normalsFromAlpha(sprite, { detail: 3 });  // plus relief from the art's shading
 *   createSpriteBatch(device, { sheets: [sprite], normals: [normals], ... });
 *
 * The silhouette is all a sprite reliably tells us about its shape. The distance from each opaque
 * texel to the nearest transparent one is a distance field; read as a height that rises steeply at
 * the edge and levels off inside (a quarter circle of `radius` texels), it is a rounded slab, and
 * its slope is a normal. Edges then catch light from their own side and rim light works, which a
 * flat card cannot do.
 *
 * The distance field is the exact Euclidean distance transform of Felzenszwalb and Huttenlocher
 * (two passes of a 1D lower-envelope-of-parabolas transform), run on the CPU at load. The plan
 * named jump flooding, which is the GPU way to approximate the same field; for sprites of a few
 * thousand texels the exact CPU transform is well under a millisecond, needs no GPU round trip and
 * gives the same result on every machine, so it is the better fit here. A GPU version only pays
 * once the art is large or changes every frame.
 */
import type { Pixels } from '../assets.ts';

export interface NormalsFromAlphaOptions {
  /** Texels over which the edge rounds off to flat. Default 4. */
  radius?: number;
  /** How tall the rounded edge is relative to its width; above 1 the slopes steepen. Default 1. */
  depth?: number;
  /**
   * Height added from the art's own luminance (texel units per unit of luminance), so painted
   * highlights read as raised and dark lines as creases. 0 (default) is the silhouette alone.
   */
  detail?: number;
  /** Box-blur passes over the height before taking its slope; softens the distance staircase. Default 1. */
  smooth?: number;
  /**
   * Width of one frame in a flipbook strip laid out left to right. Each frame is treated as its own
   * image, so frames that touch do not round into each other. Default: the whole image is one frame.
   */
  frameWidth?: number;
}

const FAR = 1e20;

/**
 * 1D squared distance transform of `f` (0 at sites, FAR elsewhere) into `out`: the lower envelope
 * of parabolas rooted at every sample (Felzenszwalb and Huttenlocher, "Distance Transforms of
 * Sampled Functions", 2012). `v`, `z` are scratch of length n and n + 1.
 */
function transform1d(
  f: Float64Array,
  n: number,
  out: Float64Array,
  v: Int32Array,
  z: Float64Array,
): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s: number;
    for (;;) {
      const p = v[k]!;
      s = (f[q]! + q * q - (f[p]! + p * p)) / (2 * q - 2 * p);
      if (s > z[k]! || k === 0) break;
      k--;
    }
    // When k reached 0 without s > z[0] (z[0] is -Infinity, so it always is), fall through.
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    const p = v[k]!;
    out[q] = (q - p) * (q - p) + f[p]!;
  }
}

/**
 * Euclidean distance, in texels, from the centre of each opaque texel (alpha >= 128) to the
 * centre of the nearest transparent one; 0 for transparent texels. Everything outside the image
 * counts as transparent, so a sprite cut off by its frame still rounds at the frame edge.
 */
export function distanceToEdge(
  alpha: ArrayLike<number>,
  width: number,
  height: number,
): Float32Array {
  // Pad by one texel of transparency on every side.
  const w = width + 2;
  const h = height + 2;
  const grid = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inside = x > 0 && y > 0 && x <= width && y <= height;
      const opaque = inside && alpha[(y - 1) * width + (x - 1)]! >= 128;
      grid[y * w + x] = opaque ? FAR : 0;
    }
  }
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const out = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  // Columns, then rows: the 2D squared transform is separable.
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x]!;
    transform1d(f, h, out, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = out[y]!;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x]!;
    transform1d(f, w, out, v, z);
    for (let x = 0; x < w; x++) grid[y * w + x] = out[x]!;
  }
  const result = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) result[y * width + x] = Math.sqrt(grid[(y + 1) * w + x + 1]!);
  }
  return result;
}

const srgbToLinear = (byte: number) => {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

function blur(height: Float32Array, opaque: Uint8Array, width: number, rows: number): Float32Array {
  const out = new Float32Array(height.length);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!opaque[i]) continue;
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const sx = x + dx;
          const sy = y + dy;
          // Outside the sprite the height is 0, which keeps the edge sloping down.
          const inside = sx >= 0 && sy >= 0 && sx < width && sy < rows;
          sum += inside ? height[sy * width + sx]! : 0;
          count++;
        }
      }
      out[i] = sum / count;
    }
  }
  return out;
}

/**
 * The height field the normals come from, in texel units: a quarter-circle bevel of `radius`
 * texels on the distance to the edge, plus optional relief from luminance. Exposed for tests and
 * for the inspector-style tools of story 10.3.
 */
export function heightFromAlpha(
  pixels: Pixels,
  options: Omit<NormalsFromAlphaOptions, 'frameWidth'> = {},
): Float32Array {
  const { width, height: rows, data } = pixels;
  const radius = Math.max(options.radius ?? 4, 0.5);
  const depth = options.depth ?? 1;
  const detail = options.detail ?? 0;
  const alpha = new Uint8Array(width * rows);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3]!;
  const distance = distanceToEdge(alpha, width, rows);
  let field: Float32Array = new Float32Array(width * rows);
  for (let i = 0; i < field.length; i++) {
    if (alpha[i]! < 128) continue;
    // Distance is measured between texel centres, so an edge texel sits half a texel inside the
    // boundary: subtract that to put the boundary at 0.
    const t = Math.min(Math.max((distance[i]! - 0.5) / radius, 0), 1);
    let h = Math.sqrt(1 - (1 - t) * (1 - t)) * radius * depth;
    if (detail) {
      const lum =
        0.2126 * srgbToLinear(data[i * 4]!) +
        0.7152 * srgbToLinear(data[i * 4 + 1]!) +
        0.0722 * srgbToLinear(data[i * 4 + 2]!);
      // Perceptual lightness rather than linear luminance, so mid-tones carry relief too.
      h += detail * Math.cbrt(lum);
    }
    field[i] = h;
  }
  const opaque = alpha.map((a) => (a >= 128 ? 1 : 0));
  for (let pass = 0; pass < (options.smooth ?? 1); pass++) {
    field = blur(field, opaque, width, rows);
  }
  return field;
}

/**
 * A tangent-space normal map for `pixels`: x right, y up the image, z out of the sprite toward the
 * viewer (the OpenGL convention), stored as `(n * 0.5 + 0.5) * 255` like any normal-map image. Alpha
 * is copied from the art. Transparent texels get the flat normal.
 *
 * The batcher packs normal maps into an `rgba8unorm` array (not sRGB, unlike the art), so a shader
 * reading this back with `textureLoad` gets the bytes as written.
 */
export function normalsFromAlpha(pixels: Pixels, options: NormalsFromAlphaOptions = {}): Pixels {
  const { width, height: rows, data } = pixels;
  const out = new Uint8Array(width * rows * 4);
  const frameWidth = Math.min(Math.max(1, Math.floor(options.frameWidth ?? width)), width);
  for (let left = 0; left < width; left += frameWidth) {
    const cell = Math.min(frameWidth, width - left);
    const frame = crop(pixels, left, cell);
    const field = heightFromAlpha(frame, options);
    const at = (x: number, y: number) =>
      x < 0 || y < 0 || x >= cell || y >= rows ? 0 : field[y * cell + x]!;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cell; x++) {
        const source = (y * width + left + x) * 4;
        const opaque = data[source + 3]! >= 128;
        let nx = 0;
        let ny = 0;
        let nz = 1;
        if (opaque) {
          // Central differences; rows run down the image, so up is row - 1.
          const dx = (at(x + 1, y) - at(x - 1, y)) / 2;
          const dy = (at(x, y - 1) - at(x, y + 1)) / 2;
          const length = Math.hypot(dx, dy, 1);
          nx = -dx / length;
          ny = -dy / length;
          nz = 1 / length;
        }
        out[source] = Math.round((nx * 0.5 + 0.5) * 255);
        out[source + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        out[source + 2] = Math.round((nz * 0.5 + 0.5) * 255);
        out[source + 3] = data[source + 3]!;
      }
    }
  }
  return { width, height: rows, data: out };
}

/** A normal map that is flat everywhere, for tiles and for the "flat" comparison. */
export function flatNormals(pixels: Pixels): Pixels {
  const out = new Uint8Array(pixels.width * pixels.height * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = 128;
    out[i + 1] = 128;
    out[i + 2] = 255;
    out[i + 3] = pixels.data[i + 3]!;
  }
  return { width: pixels.width, height: pixels.height, data: out };
}

function crop(pixels: Pixels, left: number, width: number): Pixels {
  if (left === 0 && width === pixels.width) return pixels;
  const data = new Uint8Array(width * pixels.height * 4);
  for (let y = 0; y < pixels.height; y++) {
    const start = (y * pixels.width + left) * 4;
    data.set(pixels.data.subarray(start, start + width * 4), y * width * 4);
  }
  return { width, height: pixels.height, data };
}
