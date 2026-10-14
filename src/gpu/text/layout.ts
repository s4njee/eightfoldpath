import { FALLBACK_GLYPH, type FontAtlas, type Glyph } from './atlas.ts';

/*
 * Text layout for bitmap fonts (story 3.10): glyph positions in whole texels, word wrap, and the
 * typewriter's clock.
 *
 * Every position is an integer number of texels, so at any integer scale every glyph texel lands
 * on exactly scale × scale screen pixels: that is what keeps a bitmap font crisp. The typewriter
 * gives each glyph an `order`, the moment it appears in characters typed; punctuation adds a pause
 * after itself, the way dialogue boxes in older games breathe at the end of a sentence. A renderer
 * shows a glyph once its reveal clock passes the glyph's order.
 */

export interface PlacedGlyph {
  readonly char: string;
  readonly glyph: Glyph;
  /** Top-left of the glyph box, in texels from the layout's origin. */
  readonly x: number;
  readonly y: number;
  /** When the typewriter shows it, in characters. */
  readonly order: number;
}

export interface TextLayout {
  readonly glyphs: readonly PlacedGlyph[];
  /** Widest line and total height, in texels. */
  readonly width: number;
  readonly height: number;
  readonly lines: number;
  /** Characters of typewriter time until the last glyph shows, pauses included. */
  readonly duration: number;
}

export interface LayoutOptions {
  /** Wrap words onto a new line past this width, in texels. Default: never. */
  maxWidth?: number;
  /** Texels from one line's top to the next. Default: the font's box height plus one. */
  lineHeight?: number;
  /** Extra characters of pause after punctuation. Default true. */
  pauses?: boolean;
}

const PAUSES: Readonly<Record<string, number>> = {
  '.': 6,
  '!': 6,
  '?': 6,
  '…': 8,
  ',': 3,
  ';': 3,
  ':': 3,
  '—': 3,
};

function glyphOf(atlas: FontAtlas, char: string): Glyph {
  return atlas.glyphs.get(char) ?? atlas.glyphs.get(FALLBACK_GLYPH)!;
}

/** Width of a run of characters in texels, without the spacing after the last one. */
export function measureText(atlas: FontAtlas, text: string): number {
  let width = 0;
  for (const char of text) {
    width += char === ' ' ? atlas.font.spaceWidth : glyphOf(atlas, char).advance;
  }
  const last = [...text].at(-1);
  return last && last !== ' ' ? width - atlas.font.spacing : width;
}

export function layoutText(
  atlas: FontAtlas,
  text: string,
  options: LayoutOptions = {},
): TextLayout {
  const { font } = atlas;
  const maxWidth = options.maxWidth ?? Infinity;
  const lineHeight = options.lineHeight ?? font.height + 1;
  const pauses = options.pauses ?? true;

  // Break into lines of words first, then place: a word longer than a line stays whole.
  const lines: string[][] = [];
  for (const paragraph of text.split('\n')) {
    let line: string[] = [];
    let width = 0;
    for (const word of paragraph.split(' ').filter(Boolean)) {
      const w = measureText(atlas, word);
      const next = line.length === 0 ? w : width + font.spacing + font.spaceWidth + w;
      if (line.length > 0 && next > maxWidth) {
        lines.push(line);
        line = [word];
        width = w;
      } else {
        line.push(word);
        width = next;
      }
    }
    lines.push(line);
  }

  const glyphs: PlacedGlyph[] = [];
  let clock = 0;
  let widest = 0;
  lines.forEach((words, row) => {
    let x = 0;
    words.forEach((word, w) => {
      if (w > 0) {
        // The previous glyph's advance already holds its spacing column.
        x += font.spaceWidth;
        clock += 1;
      }
      for (const char of word) {
        const glyph = glyphOf(atlas, char);
        glyphs.push({ char, glyph, x, y: row * lineHeight, order: clock });
        x += glyph.advance;
        clock += 1 + (pauses ? (PAUSES[char] ?? 0) : 0);
      }
    });
    widest = Math.max(widest, x > 0 ? x - font.spacing : 0);
    clock += 1;
  });
  return {
    glyphs,
    width: widest,
    height: lines.length > 0 ? (lines.length - 1) * lineHeight + font.height : 0,
    lines: lines.length,
    duration: glyphs.length > 0 ? glyphs.at(-1)!.order + 1 : 0,
  };
}
