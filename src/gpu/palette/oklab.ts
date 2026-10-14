/*
 * Colour conversions for the palette tools (story 3.5), on the CPU.
 *
 * OKLab (Björn Ottosson, "A perceptual color space for image processing", 2020) is where "nearest
 * palette colour" is measured: equal distances there look roughly equally different, which is not
 * true of sRGB bytes (two dark blues 20 steps apart look further apart than two yellows 20 steps
 * apart). The matrices are Ottosson's, the same as `scripts/clean-art.mjs` used to derive the
 * palette, so the palette tools and the palette agree on what "near" means.
 */

/** An 8-bit sRGB colour, as stored in the PNGs and the `.hex` palette. */
export type Rgb8 = readonly [number, number, number];
export type Vec3 = readonly [number, number, number];

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(c: number): number {
  const v = Math.max(0, c);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

/** Linear Rec.709 RGB to OKLab (L 0..1, a and b roughly -0.4..0.4). */
export function linearToOklab([r, g, b]: Vec3): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToLinear([L, A, B]: Vec3): [number, number, number] {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function rgb8ToLinear([r, g, b]: Rgb8): [number, number, number] {
  return [srgbToLinear(r / 255), srgbToLinear(g / 255), srgbToLinear(b / 255)];
}

export function rgb8ToOklab(rgb: Rgb8): [number, number, number] {
  return linearToOklab(rgb8ToLinear(rgb));
}

/** Squared OKLab distance. The square is enough for finding the nearest colour. */
export function distance2(a: Vec3, b: Vec3): number {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return dl * dl + da * da + db * db;
}

/** `rrggbb` words separated by whitespace, as in `assets/palette/eightfold.hex`. */
export function parseHexPalette(text: string): Rgb8[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((hex) => {
      const value = parseInt(hex.replace(/^#/, ''), 16);
      return [(value >> 16) & 255, (value >> 8) & 255, value & 255] as const;
    });
}

export function hexToRgb8(hex: string): Rgb8 {
  return parseHexPalette(hex)[0]!;
}

export function rgb8ToHex([r, g, b]: Rgb8): string {
  return ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

/** The index of the palette colour nearest to `lab`, by brute force over every entry. */
export function nearestIndex(lab: Vec3, paletteLab: readonly Vec3[]): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < paletteLab.length; i++) {
    const d = distance2(lab, paletteLab[i]!);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}
