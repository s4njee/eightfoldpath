// Picture metrics for the texel studies (stories 3.1, 3.8): how far a frame is from a supersampled
// reference, how much it pops from frame to frame, and how sharp its edges are. Everything works on
// luma in 8-bit display units (0..255), the scale a viewer sees differences on.

const TO_LINEAR = Float32Array.from({ length: 256 }, (_, v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

function toSrgb(linear: number): number {
  const c = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, c * 255));
}

/** Luma of tightly packed RGBA bytes: Rec. 709 weights on the encoded values. */
export function luma(rgba: Uint8Array, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) {
    out[i] = 0.2126 * rgba[i * 4]! + 0.7152 * rgba[i * 4 + 1]! + 0.0722 * rgba[i * 4 + 2]!;
  }
  return out;
}

/**
 * Luma of an image `factor` times larger, box-filtered down in linear light: the reference for a
 * supersampled render (`factor`² samples per pixel on a regular grid).
 */
export function boxDownLuma(
  rgba: Uint8Array,
  width: number,
  height: number,
  factor: number,
): Float32Array {
  const outWidth = width / factor;
  const outHeight = height / factor;
  const out = new Float32Array(outWidth * outHeight);
  const weight = 1 / (factor * factor);
  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < factor; sy++) {
        let i = ((y * factor + sy) * width + x * factor) * 4;
        for (let sx = 0; sx < factor; sx++, i += 4) {
          r += TO_LINEAR[rgba[i]!]!;
          g += TO_LINEAR[rgba[i + 1]!]!;
          b += TO_LINEAR[rgba[i + 2]!]!;
        }
      }
      out[y * outWidth + x] =
        0.2126 * toSrgb(r * weight) + 0.7152 * toSrgb(g * weight) + 0.0722 * toSrgb(b * weight);
    }
  }
  return out;
}

/** Rows `from`..`to` (fractions of the height) of a luma image, for near/far splits. */
export function rows(image: Float32Array, width: number, from: number, to: number): Float32Array {
  const height = image.length / width;
  return image.subarray(Math.floor(from * height) * width, Math.floor(to * height) * width);
}

/** Mean absolute difference. */
export function meanAbsDiff(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - b[i]!);
  return sum / a.length;
}

/**
 * Mean absolute temporal second difference, |f(t+1) - 2 f(t) + f(t-1)|. Under slow, steady motion
 * a well filtered picture changes at a steady rate, so this stays near zero; a pixel that holds and
 * then jumps (a texel boundary crossing it under nearest sampling) shows up as a spike. It needs no
 * motion compensation, which is why it is used instead of a plain frame difference.
 */
export function popping(previous: Float32Array, current: Float32Array, next: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < current.length; i++) {
    sum += Math.abs(next[i]! - 2 * current[i]! + previous[i]!);
  }
  return sum / current.length;
}

/** Mean absolute horizontal plus vertical neighbour difference: how much edge contrast there is. */
export function edgeContrast(image: Float32Array, width: number): number {
  const height = image.length / width;
  let sum = 0;
  let count = 0;
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const i = y * width + x;
      sum += Math.abs(image[i + 1]! - image[i]!) + Math.abs(image[i + width]! - image[i]!);
      count++;
    }
  }
  return sum / Math.max(1, count);
}

/** Running means of several named numbers. */
export class Means {
  private readonly sums = new Map<string, { sum: number; count: number }>();
  add(name: string, value: number): void {
    const entry = this.sums.get(name) ?? { sum: 0, count: 0 };
    entry.sum += value;
    entry.count++;
    this.sums.set(name, entry);
  }
  get(name: string): number {
    const entry = this.sums.get(name);
    return entry ? entry.sum / entry.count : NaN;
  }
  toJSON(digits = 3): Record<string, number> {
    return Object.fromEntries(
      [...this.sums.keys()].map((name) => [name, Number(this.get(name).toFixed(digits))]),
    );
  }
}
