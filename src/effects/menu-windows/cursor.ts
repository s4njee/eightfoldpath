import type { Pixels } from '../../gpu/assets.ts';

/*
 * The pointing-hand cursor (story 9.6): a 16 × 12 glove drawn for this repository as rows of
 * characters, the way the bitmap font is (src/gpu/text/font.ts), in four colours of the project
 * palette. It is built into an image at load, so it needs no file in assets/ and can be packed
 * into the same texture array as the window frame, or turned into an SVG for the CSS fallback.
 */

export const HAND: readonly string[] = [
  '.....ooo........',
  '....owwwo.......',
  '....owwwoooooooo',
  'oooowwwwwwwwwwwo',
  'occowwwwwsssssso',
  'occowwwwoooooooo',
  'occowwwwwwwwo...',
  'occowwwwwssso...',
  'occowwwwoooo....',
  'occowwwwwwwo....',
  'occoowwwwsso....',
  'oooo.ooooooo....',
];

/** Outline, glove, glove shade and cuff, as sRGB bytes from assets/palette/eightfold.hex. */
const COLOURS: Readonly<Record<string, readonly [number, number, number]>> = {
  o: [0x13, 0x12, 0x20],
  w: [0xee, 0xe6, 0xc9],
  s: [0xbf, 0x9d, 0x6c],
  c: [0x75, 0x0c, 0x17],
};

export const HAND_SIZE = [HAND[0]!.length, HAND.length] as const;

/** The hand as an RGBA image, alpha 0 or 255. */
export function handPixels(): Pixels {
  const [width, height] = HAND_SIZE;
  const data = new Uint8Array(width * height * 4);
  HAND.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      const colour = COLOURS[row[x]!];
      if (colour) data.set([...colour, 255], (y * width + x) * 4);
    }
  });
  return { width, height, data };
}

/** The hand as an SVG, one rectangle per run of a colour along a row, for CSS or an image. */
export function handSvg(): string {
  const [width, height] = HAND_SIZE;
  const hex = (c: readonly number[]) =>
    `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  const rects: string[] = [];
  HAND.forEach((row, y) => {
    for (let x = 0; x < width;) {
      let end = x + 1;
      while (end < width && row[end] === row[x]) end++;
      const colour = COLOURS[row[x]!];
      if (colour) {
        rects.push(`<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${hex(colour)}"/>`);
      }
      x = end;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">${rects.join('')}</svg>`;
}
