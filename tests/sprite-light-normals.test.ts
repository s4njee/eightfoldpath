import { describe, expect, it } from 'vitest';
import traveller from '../assets/sprites/traveller.png?url';
import { loadPixels, type Pixels } from '../src/gpu/assets.ts';
import {
  distanceToEdge,
  flatNormals,
  heightFromAlpha,
  normalsFromAlpha,
} from '../src/gpu/lighting/normals.ts';

/** An image whose opaque texels are where `inside(x, y)` holds, coloured mid grey. */
function shape(width: number, height: number, inside: (x: number, y: number) => boolean): Pixels {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data.set([128, 128, 128, inside(x, y) ? 255 : 0], i);
    }
  }
  return { width, height, data };
}

const decode = (pixels: Pixels, x: number, y: number) => {
  const i = (y * pixels.width + x) * 4;
  return [0, 1, 2].map((c) => (pixels.data[i + c]! / 255) * 2 - 1) as [number, number, number];
};

/** Brute force: distance from each opaque texel centre to the nearest transparent one. */
function bruteForce(alpha: Uint8Array, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x]! < 128) continue;
      let best = Infinity;
      for (let sy = -1; sy <= height; sy++) {
        for (let sx = -1; sx <= width; sx++) {
          const outside = sx < 0 || sy < 0 || sx >= width || sy >= height;
          if (outside || alpha[sy * width + sx]! < 128) {
            best = Math.min(best, Math.hypot(sx - x, sy - y));
          }
        }
      }
      out[y * width + x] = best;
    }
  }
  return out;
}

describe('distanceToEdge', () => {
  it('is exact on a block', () => {
    const alpha = new Uint8Array(25).fill(255);
    const distance = distanceToEdge(alpha, 5, 5);
    expect(distance[0]).toBe(1);
    expect(distance[1 * 5 + 1]).toBe(2);
    expect(distance[2 * 5 + 2]).toBe(3);
  });

  it('matches brute force on an irregular shape', () => {
    const width = 23;
    const height = 17;
    const alpha = new Uint8Array(width * height);
    for (let i = 0; i < alpha.length; i++) {
      const x = i % width;
      const y = Math.floor(i / width);
      // A blob with a hole and a notch, so distances come from several directions.
      const blob = Math.hypot(x - 11, (y - 8) * 1.3) < 9;
      const hole = Math.hypot(x - 13, y - 7) < 2.2;
      const notch = x > 15 && y > 10 && y < 13;
      alpha[i] = blob && !hole && !notch ? 255 : 0;
    }
    const fast = distanceToEdge(alpha, width, height);
    const slow = bruteForce(alpha, width, height);
    for (let i = 0; i < alpha.length; i++) expect(fast[i]).toBeCloseTo(slow[i]!, 4);
  });
});

describe('normalsFromAlpha', () => {
  const disc = shape(17, 17, (x, y) => Math.hypot(x - 8, y - 8) <= 7);

  it('faces the viewer in the middle and outward at the rim', () => {
    const normals = normalsFromAlpha(disc, { radius: 4 });
    const centre = decode(normals, 8, 8);
    expect(centre[2]).toBeGreaterThan(0.98);
    const right = decode(normals, 15, 8);
    expect(right[0]).toBeGreaterThan(0.5);
    expect(Math.abs(right[1])).toBeLessThan(0.1);
    // y is up the image, so the top row (row 1) points up.
    const top = decode(normals, 8, 1);
    expect(top[1]).toBeGreaterThan(0.5);
    const bottom = decode(normals, 8, 15);
    expect(bottom[1]).toBeLessThan(-0.5);
  });

  it('writes unit normals and keeps the alpha', () => {
    const normals = normalsFromAlpha(disc);
    for (let i = 0; i < disc.width * disc.height; i++) {
      expect(normals.data[i * 4 + 3]).toBe(disc.data[i * 4 + 3]);
      const [x, y, z] = decode(normals, i % disc.width, Math.floor(i / disc.width));
      // 8-bit quantisation allows about 1% either way.
      expect(Math.hypot(x, y, z)).toBeGreaterThan(0.97);
      expect(Math.hypot(x, y, z)).toBeLessThan(1.03);
    }
  });

  it('rounds each flipbook frame on its own', () => {
    // Two 6-texel squares touching side by side: one shape as a whole image, two as frames.
    const strip = shape(12, 6, () => true);
    const whole = heightFromAlpha(strip, { smooth: 0 });
    const framed = normalsFromAlpha(strip, { frameWidth: 6, smooth: 0 });
    // As one image the seam is the middle of the shape and stays high...
    expect(whole[2 * 12 + 5]).toBeGreaterThan(whole[2 * 12 + 0]!);
    // ...as frames each side of the seam slopes down towards it.
    expect(decode(framed, 5, 2)[0]).toBeGreaterThan(0.3);
    expect(decode(framed, 6, 2)[0]).toBeLessThan(-0.3);
  });

  it('adds relief from the art with detail', () => {
    // A bright stripe across a flat-topped block reads as a ridge.
    const block = shape(30, 30, () => true);
    for (let x = 0; x < 30; x++) block.data.set([255, 255, 255], (15 * 30 + x) * 4);
    const plain = normalsFromAlpha(block, { radius: 2, smooth: 0 });
    const relief = normalsFromAlpha(block, { radius: 2, smooth: 0, detail: 4 });
    expect(decode(plain, 15, 14)[1]).toBeCloseTo(0, 1);
    // The row above the ridge slopes up towards it, so it faces up; the row below faces down.
    expect(decode(relief, 15, 14)[1]).toBeGreaterThan(0.3);
    expect(decode(relief, 15, 16)[1]).toBeLessThan(-0.3);
  });

  it('handles the real traveller quickly', async () => {
    const sprite = await loadPixels(traveller);
    const start = performance.now();
    const normals = normalsFromAlpha(sprite);
    const ms = performance.now() - start;
    expect(normals.width).toBe(sprite.width);
    // Generous: the point is that it is a load-time cost, not a frame-time one.
    expect(ms).toBeLessThan(50);
    expect(flatNormals(sprite).data[2]).toBe(255);
  });
});
