import { describe, expect, it } from 'vitest';
import {
  buildFontAtlas,
  FALLBACK_GLYPH,
  layoutText,
  measureText,
  nineSliceQuads,
  textQuads,
  WAYFARER,
} from '../src/gpu/text/index.ts';
import { mountHeadless } from './headless.ts';

describe('the Wayfarer font', () => {
  const printable = Array.from({ length: 126 - 32 }, (_, i) => String.fromCharCode(33 + i));

  it('has a glyph for every printable ASCII character', () => {
    expect(printable.filter((c) => !(c in WAYFARER.glyphs))).toEqual([]);
  });

  it('draws every glyph with ink, in rows of one width that fit the box', () => {
    for (const [char, rows] of Object.entries(WAYFARER.glyphs)) {
      expect(rows.length, char).toBeLessThanOrEqual(WAYFARER.height);
      expect(new Set(rows.map((row) => row.length)).size, char).toBe(1);
      expect(
        rows.every((row) => /^[#.]+$/.test(row)),
        char,
      ).toBe(true);
      expect(rows.join('').includes('#'), char).toBe(true);
    }
  });

  it('gives distinct glyphs to distinct characters (apart from deliberate twins)', () => {
    const twins = new Set(["'", '’']);
    const seen = new Map<string, string>();
    for (const [char, rows] of Object.entries(WAYFARER.glyphs)) {
      if (twins.has(char)) continue;
      const key = rows.join('/');
      expect(seen.get(key), `${char} looks like ${seen.get(key)}`).toBeUndefined();
      seen.set(key, char);
    }
  });

  it('keeps capitals and digits to the cap height, and only g j p q y , ; _ | below it', () => {
    const descending = new Set(['g', 'j', 'p', 'q', 'y', ',', ';', '_', '|']);
    for (const [char, rows] of Object.entries(WAYFARER.glyphs)) {
      const below = rows.slice(WAYFARER.ascent).some((row) => row.includes('#'));
      expect(below, char).toBe(descending.has(char));
    }
  });
});

describe('font atlas', () => {
  const atlas = buildFontAtlas();

  it('has binary alpha and white ink', () => {
    const { data } = atlas.pixels;
    for (let p = 0; p < data.length; p += 4) {
      expect([0, 255]).toContain(data[p + 3]);
      if (data[p + 3]) expect([data[p], data[p + 1], data[p + 2]]).toEqual([255, 255, 255]);
    }
  });

  it('trims glyphs to their ink, so the text is proportional', () => {
    expect(atlas.glyphs.get('i')!.width).toBe(3);
    expect(atlas.glyphs.get('m')!.width).toBe(5);
    expect(atlas.glyphs.get('.')!.width).toBe(1);
    expect(atlas.glyphs.get('A')!.advance).toBe(6);
  });

  it('copies each glyph exactly', () => {
    const glyph = atlas.glyphs.get('R')!;
    const rows = WAYFARER.glyphs.R!;
    for (let y = 0; y < rows.length; y++) {
      for (let x = 0; x < glyph.width; x++) {
        const alpha = atlas.pixels.data[((glyph.y + y) * atlas.pixels.width + glyph.x + x) * 4 + 3];
        expect(alpha === 255, `R ${x},${y}`).toBe(rows[y]![x] === '#');
      }
    }
  });
});

describe('text layout', () => {
  const atlas = buildFontAtlas();

  it('places glyphs on whole texels', () => {
    const layout = layoutText(atlas, 'Hello, wanderer.');
    expect(layout.glyphs.every((g) => Number.isInteger(g.x) && Number.isInteger(g.y))).toBe(true);
    expect(layout.width).toBe(measureText(atlas, 'Hello, wanderer.'));
  });

  it('wraps on words within the width and keeps long words whole', () => {
    const layout = layoutText(atlas, 'one two three four five six', { maxWidth: 40 });
    expect(layout.lines).toBeGreaterThan(1);
    expect(layout.width).toBeLessThanOrEqual(40);
    const long = layoutText(atlas, 'extraordinarily', { maxWidth: 10 });
    expect(long.lines).toBe(1);
  });

  it('honours explicit line breaks', () => {
    expect(layoutText(atlas, 'a\nb\nc').lines).toBe(3);
  });

  it('times the typewriter in characters, pausing after punctuation', () => {
    const plain = layoutText(atlas, 'ab cd', { pauses: false });
    expect(plain.glyphs.map((g) => g.order)).toEqual([0, 1, 3, 4]);
    const paused = layoutText(atlas, 'a. b');
    expect(paused.glyphs.at(-1)!.order).toBeGreaterThan(plain.glyphs[2]!.order + 3);
    expect(paused.duration).toBe(paused.glyphs.at(-1)!.order + 1);
  });

  it('draws unknown characters with the fallback glyph', () => {
    const layout = layoutText(atlas, 'é');
    expect(layout.glyphs[0]!.glyph).toBe(atlas.glyphs.get(FALLBACK_GLYPH));
  });
});

describe('pixel quads', () => {
  const atlas = buildFontAtlas();

  it('scale text by whole numbers, shadow first', () => {
    const layout = layoutText(atlas, 'Hi');
    const quads = textQuads(layout, { x: 10, y: 20, scale: 3, layer: 0, shadow: [0, 0, 0] });
    expect(quads).toHaveLength(4);
    expect(quads[0]!.dst).toEqual([13, 23, 15, 27]);
    expect(quads[2]!.dst).toEqual([10, 20, 15, 27]);
    expect(quads[3]!.dst[0]).toBe(10 + 6 * 3);
  });

  it('nine-slice: corners kept, edges and centre filling the rest', () => {
    const frame = { insets: [7, 6, 7, 7] as const, width: 74, height: 51 };
    const quads = nineSliceQuads(frame, 1, [0, 0, 200, 60], 2);
    expect(quads).toHaveLength(9);
    expect(quads[0]!.dst).toEqual([0, 0, 14, 12]);
    expect(quads[4]!.src).toEqual([7, 6, 60, 38]);
    expect(quads[4]!.dst).toEqual([14, 12, 372, 94]);
    expect(quads[8]!.dst).toEqual([386, 106, 14, 14]);
  });
});

describe('bitmap-text effect', () => {
  it('draws glyph texels as whole blocks of the scale', async () => {
    // At 3 pixels per texel every run of ink colour along a row has a length divisible by 3,
    // unless something resampled the font.
    const scale = 3;
    const headless = await mountHeadless('bitmap-text', {
      width: 720,
      height: 405,
      params: { scale, typewriter: false },
    });
    headless.step();
    const pixels = await headless.read();
    headless.destroy();
    const ink = [0x42, 0x26, 0x1e];
    let runs = 0;
    for (let y = 0; y < 405; y++) {
      let run = 0;
      for (let x = 0; x <= 720; x++) {
        const p = (y * 720 + x) * 4;
        const isInk =
          x < 720 && pixels[p] === ink[0] && pixels[p + 1] === ink[1] && pixels[p + 2] === ink[2];
        if (isInk) run++;
        else if (run > 0) {
          expect(run % scale, `row ${y} ends at ${x}`).toBe(0);
          runs++;
          run = 0;
        }
      }
    }
    expect(runs).toBeGreaterThan(100);
  });
});
