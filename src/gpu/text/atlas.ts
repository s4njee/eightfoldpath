import type { Pixels } from '../assets.ts';
import { WAYFARER, type BitmapFont } from './font.ts';

/*
 * The font atlas (story 3.10): every glyph of a bitmap font in one small image, built at load
 * from the glyph strings in font.ts. White ink with alpha exactly 0 or 255, so it packs into the
 * same texture array as the pixel art (`packTextureArray`) and the shader tints it to any colour.
 * Glyphs sit in a grid of fixed cells with a blank column and row between them, so nothing bleeds
 * even if a caller samples it with a filter.
 */

export interface Glyph {
  /** Top-left of the glyph's ink box in the atlas, in texels. */
  readonly x: number;
  readonly y: number;
  /** Ink width; the height is always the font's full box height. */
  readonly width: number;
  readonly height: number;
  /** Texels to the next glyph's origin: ink width plus the font's spacing. */
  readonly advance: number;
}

export interface FontAtlas {
  readonly font: BitmapFont;
  readonly pixels: Pixels;
  readonly glyphs: ReadonlyMap<string, Glyph>;
}

/** The glyph drawn for a character the font does not have. */
export const FALLBACK_GLYPH = '?';

export function buildFontAtlas(font: BitmapFont = WAYFARER, columns = 16): FontAtlas {
  const chars = Object.keys(font.glyphs);
  const maxWidth = Math.max(...chars.map((c) => Math.max(...font.glyphs[c]!.map((r) => r.length))));
  const cellWidth = maxWidth + 1;
  const cellHeight = font.height + 1;
  const rows = Math.ceil(chars.length / columns);
  const width = columns * cellWidth;
  const height = rows * cellHeight;
  const data = new Uint8Array(width * height * 4);
  const glyphs = new Map<string, Glyph>();

  chars.forEach((char, i) => {
    const rowsOfInk = font.glyphs[char]!;
    if (rowsOfInk.length > font.height) {
      throw new Error(`Glyph ${JSON.stringify(char)} is ${rowsOfInk.length} rows tall`);
    }
    // Trim to the ink so the text is proportional; a glyph with no ink keeps one column.
    let first = Infinity;
    let last = -Infinity;
    for (const row of rowsOfInk) {
      for (let x = 0; x < row.length; x++) {
        if (row[x] === '#') {
          first = Math.min(first, x);
          last = Math.max(last, x);
        }
      }
    }
    if (first === Infinity) first = last = 0;
    const cellX = (i % columns) * cellWidth;
    const cellY = Math.floor(i / columns) * cellHeight;
    rowsOfInk.forEach((row, y) => {
      for (let x = first; x <= last; x++) {
        if (row[x] !== '#') continue;
        data.set([255, 255, 255, 255], ((cellY + y) * width + cellX + x - first) * 4);
      }
    });
    const inkWidth = last - first + 1;
    glyphs.set(char, {
      x: cellX,
      y: cellY,
      width: inkWidth,
      height: font.height,
      advance: inkWidth + font.spacing,
    });
  });
  return { font, pixels: { width, height, data }, glyphs };
}
