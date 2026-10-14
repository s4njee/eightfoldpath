import { describe, expect, it } from 'vitest';
import {
  bayerMatrix,
  buildPaletteLut,
  buildRamp,
  cycleIndex,
  distance2,
  EIGHTFOLD,
  generateBlueNoise,
  indexImage,
  lookupLut,
  LUT_SIZE,
  nearestIndex,
  rgb8ToOklab,
  TRANSPARENT_INDEX,
  linearToOklab,
  rgb8ToHex,
  srgbToLinear,
  type Rgb8,
  type Vec3,
} from '../src/gpu/palette/index.ts';
import { gpuF32, rowsOf } from './wgsl-eval.ts';

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

describe('the eightfold palette', () => {
  it('has 48 colours', () => {
    expect(EIGHTFOLD).toHaveLength(48);
  });
});

describe('palette lookup table', () => {
  const lut = buildPaletteLut(EIGHTFOLD);
  const labs = EIGHTFOLD.map(rgb8ToOklab);

  it('is 32³ and only holds palette indices', () => {
    expect(lut).toHaveLength(LUT_SIZE ** 3);
    expect(Math.max(...lut)).toBeLessThan(EIGHTFOLD.length);
  });

  it('agrees with the brute-force search at every cell centre', () => {
    // By construction; this guards the cell ordering (red fastest) against the lookup.
    for (let i = 0; i < 2000; i++) {
      const cell = [i % 32, (i * 7) % 32, (i * 13) % 32] as const;
      const centre = cell.map((c) => srgbToLinear(c / 31)) as unknown as Vec3;
      const index = lut[(cell[2] * 32 + cell[1]) * 32 + cell[0]];
      expect(index).toBe(nearestIndex(linearToOklab(centre), labs));
    }
  });

  it('matches the brute-force search for most colours and is never far off when it does not', () => {
    const random = mulberry32(7);
    const samples = 100_000;
    let agree = 0;
    let worstExcess = 0;
    let excessSum = 0;
    for (let i = 0; i < samples; i++) {
      const rgb: Rgb8 = [
        Math.floor(random() * 256),
        Math.floor(random() * 256),
        Math.floor(random() * 256),
      ];
      const lab = rgb8ToOklab(rgb);
      const exact = nearestIndex(lab, labs);
      const fromLut = lookupLut(lut, rgb);
      if (exact === fromLut) {
        agree++;
        continue;
      }
      // How much further the table's answer is than the true nearest, in OKLab units.
      const excess =
        Math.sqrt(distance2(lab, labs[fromLut]!)) - Math.sqrt(distance2(lab, labs[exact]!));
      worstExcess = Math.max(worstExcess, excess);
      excessSum += excess;
    }
    const rate = agree / samples;
    console.info(
      `palette LUT vs brute force over ${samples} random colours: ${(rate * 100).toFixed(2)}% agree; ` +
        `when they differ the LUT's pick is on average ${(excessSum / Math.max(1, samples - agree)).toFixed(4)} ` +
        `and at worst ${worstExcess.toFixed(4)} further in OKLab`,
    );
    expect(rate).toBeGreaterThan(0.9);
    // A just-noticeable difference in OKLab is about 0.02.
    expect(worstExcess).toBeLessThan(0.05);
  });

  it('reports which palette colours the table can reach', () => {
    const reached = new Set(lut);
    const selfMapped = EIGHTFOLD.filter((colour, i) => lookupLut(lut, colour) === i).length;
    console.info(
      `palette LUT reaches ${reached.size} of ${EIGHTFOLD.length} colours; ` +
        `${selfMapped} map to themselves`,
    );
    expect(reached.size).toBeGreaterThan(EIGHTFOLD.length * 0.8);
  });

  it('agrees with the brute-force search on the GPU (palette.wgsl OKLab)', async () => {
    const colours: Rgb8[] = [
      [0, 0, 0],
      [255, 255, 255],
      [200, 30, 40],
      [20, 120, 220],
      [128, 128, 128],
    ];
    const out = await gpuF32(
      '#include "palette.wgsl"\nfn f(x: vec4f) -> vec4f { return vec4f(linear_to_oklab(srgb_to_linear(x.rgb)), 0.0); }',
      rowsOf(colours.map(([r, g, b]) => [r / 255, g / 255, b / 255, 0])),
    );
    colours.forEach((colour, i) => {
      const lab = rgb8ToOklab(colour);
      for (let c = 0; c < 3; c++) expect(out[i * 4 + c]).toBeCloseTo(lab[c]!, 3);
    });
  });
});

describe('dither thresholds', () => {
  it('Bayer: every rank once, and each 2 × 2 block is [[0, 2], [3, 1]] scaled by 16', () => {
    const m = bayerMatrix();
    expect([...m].sort((a, b) => a - b)).toEqual(Array.from({ length: 64 }, (_, i) => i));
    // The finest level is the most significant: neighbours are as far apart in rank as possible.
    expect([m[0], m[1], m[8], m[9]]).toEqual([0, 32, 48, 16]);
  });

  it('palette_bayer8 on the GPU matches the recursive definition', async () => {
    const m = bayerMatrix();
    const coords = Array.from({ length: 64 }, (_, i) => [i % 8, Math.floor(i / 8), 0, 0]);
    const out = await gpuF32(
      '#include "palette.wgsl"\nfn f(x: vec4f) -> vec4f { return vec4f(palette_bayer8(vec2u(x.xy) + vec2u(8u, 16u))); }',
      rowsOf(coords),
    );
    for (let i = 0; i < 64; i++) expect(out[i * 4]).toBeCloseTo((m[i]! + 0.5) / 64, 5);
  });

  it('blue noise: a flat histogram that tiles', () => {
    const tile = generateBlueNoise({ size: 32 });
    const histogram = new Array(256).fill(0);
    for (const v of tile) histogram[v]++;
    expect(Math.max(...histogram)).toBe(4);
    expect(Math.min(...histogram)).toBe(4);
  });
});

describe('palette ramps', () => {
  it('go from dark to light through distinct palette colours', () => {
    for (const base of [EIGHTFOLD[34]!, EIGHTFOLD[31]!, EIGHTFOLD[26]!, EIGHTFOLD[40]!]) {
      const ramp = buildRamp(EIGHTFOLD, base);
      console.info(
        `ramp from ${rgb8ToHex(base)}: ${ramp.map((i) => rgb8ToHex(EIGHTFOLD[i]!)).join(' ')}`,
      );
      expect(ramp.length).toBeGreaterThanOrEqual(4);
      expect(new Set(ramp).size).toBe(ramp.length);
      const lightness = ramp.map((i) => rgb8ToOklab(EIGHTFOLD[i]!)[0]);
      expect(lightness).toEqual([...lightness].sort((a, b) => a - b));
    }
  });
});

describe('indexed images and cycling', () => {
  const pixels = {
    width: 4,
    height: 1,
    data: new Uint8Array([10, 0, 0, 255, 200, 0, 0, 255, 12, 0, 0, 255, 0, 0, 0, 0]),
  };

  it('maps to a per-image palette with the leading colours first', () => {
    const image = indexImage(pixels, { leading: [[200, 0, 0]] });
    expect(image.palette[0]).toEqual([200, 0, 0]);
    expect(image.indices[1]).toBe(0);
    expect(image.indices[3]).toBe(TRANSPARENT_INDEX);
    // Two near-identical darks; with room for both each keeps its own entry.
    expect(image.indices[0]).not.toBe(image.indices[2]);
  });

  it('maps colours beyond the limit to their nearest kept neighbour', () => {
    const image = indexImage(pixels, { maxColours: 2, leading: [[200, 0, 0]] });
    expect(image.palette).toHaveLength(2);
    expect(image.indices[0]).toBe(image.indices[2]);
  });

  it('rotates only inside the range, wrapping both ways', () => {
    const range = { start: 2, length: 4 };
    expect(cycleIndex(1, range, 1)).toBe(1);
    expect(cycleIndex(6, range, 1)).toBe(6);
    expect([2, 3, 4, 5].map((i) => cycleIndex(i, range, 1))).toEqual([5, 2, 3, 4]);
    expect([2, 3, 4, 5].map((i) => cycleIndex(i, range, -1))).toEqual([3, 4, 5, 2]);
    expect(cycleIndex(3, range, 9)).toBe(cycleIndex(3, range, 1));
  });
});
