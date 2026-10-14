import { createTextureFromData } from '../texture.ts';

/*
 * Dither thresholds for palette mapping (story 3.5).
 *
 * Mapping every pixel to its nearest palette colour turns a smooth gradient into flat bands. A
 * dither adds a small, fixed offset per pixel before the lookup, so a colour halfway between two
 * palette entries comes out as a mix of both whose average is the colour. The offsets come from a
 * threshold pattern with values spread evenly over 0..1:
 *
 * - Bayer's ordered matrix (Bayer 1973) is the classic crosshatch of 8- and 16-bit games: regular,
 *   so it reads as a deliberate texture, and it costs a few integer operations (`palette_bayer8`).
 * - Blue noise has the same even spread with no visible structure, so it reads as fine grain
 *   rather than a pattern. There is no blue-noise asset, so the tile is generated here with
 *   Ulichney's void-and-cluster method, ported from Fire Temple's `src/gpu/volume/blue-noise.ts`
 *   (MIT).
 */

/** The 8 × 8 Bayer matrix, ranks 0..63, row by row. The CPU twin of `palette_bayer8`. */
export function bayerMatrix(order = 3): Uint8Array {
  // M(2n) = [[4M, 4M + 2], [4M + 3, 4M + 1]], starting from M(1) = [0].
  let size = 1;
  let matrix = new Uint8Array([0]);
  for (let level = 0; level < order; level++) {
    const next = new Uint8Array(size * 2 * size * 2);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = matrix[y * size + x]! * 4;
        next[y * size * 2 + x] = v;
        next[y * size * 2 + x + size] = v + 2;
        next[(y + size) * size * 2 + x] = v + 3;
        next[(y + size) * size * 2 + x + size] = v + 1;
      }
    }
    matrix = next;
    size *= 2;
  }
  return matrix;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BlueNoiseOptions {
  /** Side of the square tile in texels. Default 64 (4096 ranks, 16 of each byte value). */
  size?: number;
  seed?: number;
  /** Standard deviation of the energy kernel in texels; 1.5 is Ulichney's value. */
  sigma?: number;
}

/**
 * A `size` × `size` blue-noise tile as bytes, row by row; values are ranks scaled to 0..255, so
 * the histogram is flat. Ulichney, "The void-and-cluster method for dither array generation"
 * (1993): rank every cell by repeatedly removing the tightest cluster or filling the largest
 * void of a point pattern, measured with a Gaussian that wraps around the tile, so it tiles
 * seamlessly. Deterministic per seed; tens of milliseconds for 64 × 64.
 */
export function generateBlueNoise(options: BlueNoiseOptions = {}): Uint8Array {
  const size = Math.max(4, Math.floor(options.size ?? 64));
  const sigma = options.sigma ?? 1.5;
  const count = size * size;
  const random = mulberry32(options.seed ?? 1);

  // Cut the Gaussian where it is negligible, and never past half the tile so the wrap cannot
  // count a cell twice.
  const reach = Math.min(Math.ceil(sigma * 4.8), Math.floor((size - 1) / 2));
  const span = reach * 2 + 1;
  const kernel = new Float64Array(span * span);
  for (let y = -reach; y <= reach; y++) {
    for (let x = -reach; x <= reach; x++) {
      kernel[(y + reach) * span + x + reach] = Math.exp(-(x * x + y * y) / (2 * sigma * sigma));
    }
  }

  const points = new Uint8Array(count);
  const energy = new Float64Array(count);
  const splat = (index: number, sign: 1 | -1) => {
    points[index] = sign === 1 ? 1 : 0;
    const cx = index % size;
    const cy = (index - cx) / size;
    for (let ky = 0; ky < span; ky++) {
      const row = ((cy + ky - reach + size) % size) * size;
      for (let kx = 0; kx < span; kx++) {
        energy[row + ((cx + kx - reach + size) % size)]! += sign * kernel[ky * span + kx]!;
      }
    }
  };
  const extreme = (set: 0 | 1) => {
    let best = -1;
    let bestEnergy = set === 1 ? -Infinity : Infinity;
    for (let i = 0; i < count; i++) {
      if (points[i] !== set) continue;
      const e = energy[i]!;
      if (set === 1 ? e > bestEnergy : e < bestEnergy) {
        bestEnergy = e;
        best = i;
      }
    }
    return best;
  };
  const tightestCluster = () => extreme(1);
  const largestVoid = () => extreme(0);

  // 1. A random tenth of the cells, relaxed until the tightest cluster's point would move
  //    straight back into the void it came from.
  const initial = Math.max(1, Math.floor(count / 10));
  for (let placed = 0; placed < initial;) {
    const index = Math.floor(random() * count);
    if (points[index] === 0) {
      splat(index, 1);
      placed++;
    }
  }
  for (let guard = 0; guard < count * 4; guard++) {
    const cluster = tightestCluster();
    splat(cluster, -1);
    const hole = largestVoid();
    splat(hole, 1);
    if (hole === cluster) break;
  }

  const ranks = new Int32Array(count);
  const startPoints = points.slice();
  const startEnergy = energy.slice();
  // 2. Ranks below the initial count: peel points off, tightest cluster first.
  for (let rank = initial - 1; rank >= 0; rank--) {
    const cluster = tightestCluster();
    splat(cluster, -1);
    ranks[cluster] = rank;
  }
  // 3. Ranks above it: fill the largest void again and again.
  points.set(startPoints);
  energy.set(startEnergy);
  for (let rank = initial; rank < count; rank++) {
    const hole = largestVoid();
    splat(hole, 1);
    ranks[hole] = rank;
  }

  const bytes = new Uint8Array(count);
  for (let i = 0; i < count; i++) bytes[i] = Math.floor((ranks[i]! * 256) / count);
  return bytes;
}

export const BLUE_NOISE_SIZE = 64;

/**
 * An `r8unorm` blue-noise tile for `palette_blue_noise`, which reads it with `textureLoad` and
 * wraps the coordinate itself: no sampler, no mipmaps.
 */
export function createBlueNoiseTexture(device: GPUDevice, size = BLUE_NOISE_SIZE): GPUTexture {
  return createTextureFromData(device, {
    label: 'blue noise',
    width: size,
    height: size,
    format: 'r8unorm',
    data: generateBlueNoise({ size }),
  });
}
