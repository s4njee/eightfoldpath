import { createTextureFromData } from '../texture.ts';
import { nearestIndex, rgb8ToOklab, linearToOklab, srgbToLinear, type Rgb8 } from './oklab.ts';

/*
 * The nearest-palette-colour lookup table (story 3.5).
 *
 * Finding the nearest of 48 colours in OKLab is 48 cube roots and distances per pixel. A 32³ table
 * answers it with one texture load: every cell holds the palette colour nearest to the colour at
 * the cell's centre, so the shader rounds its colour to a cell and reads the answer. It is built
 * here on the CPU at start-up (32 768 cells × 48 colours, a few milliseconds) rather than in a
 * compute pass, so it needs no compute shader, runs the same in the tests, and can be checked
 * against the brute-force search it replaces (tests/palette-lut.test.ts).
 *
 * The cells are spaced evenly in sRGB-encoded values, not linear light: the encoding is closer to
 * perceptually even, so 32 steps of it lose less in the darks than 32 steps of linear would.
 *
 * A table is an approximation. A colour is answered for its cell's centre, so near the boundary
 * between two palette colours it can get the other one, and a palette colour that sits between
 * cell centres can be unreachable (the test measures both).
 */

/** Cells along each axis. 32 is what plan.md asks for: 128 kB as RGBA8. */
export const LUT_SIZE = 32;

/** The cell a colour falls in, per axis, for 0..1 sRGB-encoded input. Matches `palette.wgsl`. */
export function lutCell(srgb: number, size = LUT_SIZE): number {
  return Math.min(size - 1, Math.max(0, Math.round(srgb * (size - 1))));
}

/**
 * Palette indices for every cell, red fastest, then green, then blue: the order of a 3D texture
 * written row by row and slice by slice.
 */
export function buildPaletteLut(palette: readonly Rgb8[], size = LUT_SIZE): Uint8Array {
  if (palette.length === 0 || palette.length > 256) {
    throw new Error(`A palette LUT needs 1 to 256 colours, not ${palette.length}`);
  }
  const labs = palette.map(rgb8ToOklab);
  const linear = Float64Array.from({ length: size }, (_, i) => srgbToLinear(i / (size - 1)));
  const indices = new Uint8Array(size * size * size);
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const lab = linearToOklab([linear[r]!, linear[g]!, linear[b]!]);
        indices[(b * size + g) * size + r] = nearestIndex(lab, labs);
      }
    }
  }
  return indices;
}

/** What the shader's table lookup returns for an 8-bit colour: the CPU twin of `palette_lut_index`. */
export function lookupLut(indices: Uint8Array, [r, g, b]: Rgb8, size = LUT_SIZE): number {
  const cell = (byte: number) => lutCell(byte / 255, size);
  return indices[(cell(b) * size + cell(g)) * size + cell(r)]!;
}

/**
 * The table as RGBA8 texels: the palette colour's sRGB bytes in RGB and its index in alpha, so a
 * shader gets both the colour and which entry it was from one load.
 */
export function lutTexels(palette: readonly Rgb8[], indices: Uint8Array): Uint8Array {
  const texels = new Uint8Array(indices.length * 4);
  for (let i = 0; i < indices.length; i++) {
    const colour = palette[indices[i]!]!;
    texels.set([colour[0], colour[1], colour[2], indices[i]!], i * 4);
  }
  return texels;
}

/**
 * The table as a 3D `rgba8unorm-srgb` texture: `textureLoad` returns the palette colour in linear
 * light, and alpha (never sRGB-decoded) is the index over 255. Read it with `palette_lut_lookup`.
 */
export function createPaletteLutTexture(
  device: GPUDevice,
  palette: readonly Rgb8[],
  size = LUT_SIZE,
  indices = buildPaletteLut(palette, size),
): GPUTexture {
  const texture = device.createTexture({
    label: 'palette lut',
    size: [size, size, size],
    dimension: '3d',
    format: 'rgba8unorm-srgb',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture(
    { texture },
    lutTexels(palette, indices) as Uint8Array<ArrayBuffer>,
    { bytesPerRow: size * 4, rowsPerImage: size },
    [size, size, size],
  );
  return texture;
}

/**
 * The palette itself as a `count × 1` `rgba8unorm-srgb` texture, for the exact search
 * (`palette_nearest_exact`) and for showing swatches.
 */
export function createPaletteTexture(device: GPUDevice, palette: readonly Rgb8[]): GPUTexture {
  const data = new Uint8Array(palette.length * 4);
  palette.forEach((colour, i) => data.set([colour[0], colour[1], colour[2], 255], i * 4));
  return createTextureFromData(device, {
    label: 'palette',
    width: palette.length,
    height: 1,
    format: 'rgba8unorm-srgb',
    data,
  });
}
