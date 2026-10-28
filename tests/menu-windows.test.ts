import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HAND, HAND_SIZE, handPixels, handSvg } from '../src/effects/menu-windows/cursor.ts';
import { COMMANDS } from '../src/effects/menu-windows/dom.ts';
import {
  BORDER,
  cursorNudge,
  cursorRect,
  glassCeiling,
  luminance,
  menuLayout,
  moveCursor,
  ROW_HEIGHT,
  type Rect,
} from '../src/effects/menu-windows/layout.ts';
import { hexToRgb8, rgb8ToLinear } from '../src/gpu/palette/oklab.ts';
import { mountHeadless } from './headless.ts';

const labels = COMMANDS.map((command) => command.label);

const contains = (outer: Rect, inner: Rect) =>
  inner[0] >= outer[0] &&
  inner[1] >= outer[1] &&
  inner[0] + inner[2] <= outer[0] + outer[2] &&
  inner[1] + inner[3] <= outer[1] + outer[3];
const overlaps = (a: Rect, b: Rect) =>
  a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
const interior = (rect: Rect): Rect => {
  const [left, top, right, bottom] = BORDER.insets;
  return [rect[0] + left, rect[1] + top, rect[2] - left - right, rect[3] - top - bottom];
};

describe('cursor navigation', () => {
  it('moves down and up, wrapping round at the ends', () => {
    expect(moveCursor(0, 'ArrowDown', labels)).toBe(1);
    expect(moveCursor(labels.length - 1, 'ArrowDown', labels)).toBe(0);
    expect(moveCursor(0, 'ArrowUp', labels)).toBe(labels.length - 1);
    expect(moveCursor(3, 'ArrowUp', labels)).toBe(2);
  });

  it('jumps to the ends with Home and End', () => {
    expect(moveCursor(3, 'Home', labels)).toBe(0);
    expect(moveCursor(1, 'End', labels)).toBe(labels.length - 1);
  });

  it('jumps to the next item starting with a letter, cycling through matches', () => {
    // Skills, Status, Save all start with S.
    expect(moveCursor(0, 's', labels)).toBe(labels.indexOf('Skills'));
    expect(moveCursor(labels.indexOf('Skills'), 'S', labels)).toBe(labels.indexOf('Status'));
    expect(moveCursor(labels.indexOf('Status'), 's', labels)).toBe(labels.indexOf('Save'));
    expect(moveCursor(labels.indexOf('Save'), 's', labels)).toBe(labels.indexOf('Skills'));
    expect(moveCursor(0, 'e', labels)).toBe(labels.indexOf('Equip'));
    expect(moveCursor(0, 'z', labels)).toBeUndefined();
  });

  it('leaves every other key alone', () => {
    for (const key of ['Tab', 'Enter', ' ', 'ArrowLeft', 'Escape', 'Shift', '.']) {
      expect(moveCursor(2, key, labels), key).toBeUndefined();
    }
    expect(moveCursor(0, 'ArrowDown', [])).toBeUndefined();
  });

  it('points the hand at the item, left of its label and centred on the row', () => {
    const layout = menuLayout(320, 180, labels.length);
    labels.forEach((_, i) => {
      const hand = cursorRect(layout, i);
      const item = layout.items[i]!;
      expect(hand[0] + hand[2]).toBeLessThanOrEqual(item[0]);
      expect(hand[1] * 2 + hand[3]).toBeCloseTo(item[1] * 2 + ROW_HEIGHT, -0.5);
      expect(contains(interior(layout.commands), hand)).toBe(true);
    });
    // The nudge is one texel towards the label, a whole texel at a time.
    expect(cursorRect(layout, 0, 1)[0]).toBe(cursorRect(layout, 0)[0] + 1);
    expect(new Set(Array.from({ length: 40 }, (_, i) => cursorNudge(i / 20, true)))).toEqual(
      new Set([0, 1]),
    );
    expect(cursorNudge(0.3, false)).toBe(0);
  });
});

describe('the menu layout', () => {
  it.each([
    [320, 180],
    [426, 300],
    [195, 420],
    [140, 260],
  ] as const)('keeps the windows on a %i x %i canvas and apart', (width, height) => {
    const layout = menuLayout(width, height, labels.length);
    const windows = [layout.commands, layout.party, layout.message];
    for (const window of windows) expect(contains([0, 0, width, height], window)).toBe(true);
    expect(overlaps(layout.commands, layout.party)).toBe(false);
    expect(overlaps(layout.party, layout.message)).toBe(false);
    for (const item of layout.items) expect(contains(interior(layout.commands), item)).toBe(true);
    expect(contains(interior(layout.party), layout.stats)).toBe(true);
    expect(contains(interior(layout.message), layout.line)).toBe(true);
    if (layout.portrait) expect(contains(interior(layout.party), layout.portrait)).toBe(true);
  });

  it('puts the windows side by side when there is room and stacks them when not', () => {
    const wide = menuLayout(320, 180, labels.length);
    expect(wide.party[0]).toBeGreaterThan(wide.commands[0] + wide.commands[2]);
    const narrow = menuLayout(180, 420, labels.length);
    expect(narrow.party[1]).toBeGreaterThan(narrow.commands[1] + narrow.commands[3]);
  });
});

describe('the glass ceiling', () => {
  it('is the brightest background that keeps the text at the contrast asked for', () => {
    for (const text of [0.69, 0.79, 1]) {
      for (const ratio of [3, 4.5, 7]) {
        const ceiling = glassCeiling(text, ratio);
        expect((text + 0.05) / (ceiling + 0.05)).toBeCloseTo(ratio, 6);
      }
    }
    expect(glassCeiling(0.7, 1)).toBe(0.7);
    expect(glassCeiling(0.1, 10)).toBe(0);
  });

  it('holds in the shader: an untinted window is never brighter than the ceiling', async () => {
    // No tint, so the glass is the blurred scene alone and only the ceiling dims it.
    const mounted = await mountHeadless('menu-windows', {
      width: 480,
      height: 270,
      params: { tintAmount: 0, contrast: 4.5 },
    });
    mounted.step(2);
    const pixels = await mounted.read();
    mounted.destroy();
    // menu-windows draws in whole texels of 2 pixels at this size; sample the message window's
    // empty right-hand half, which has no text over it.
    const layout = menuLayout(240, 135, labels.length);
    const [x, y, w, h] = interior(layout.message);
    // The dimmer of the menu's two text colours, as the effect works it out.
    const ink = (hex: string) => luminance(rgb8ToLinear(hexToRgb8(hex)));
    const ceiling = glassCeiling(Math.min(ink('eee6c9'), ink('fad719')), 4.5);
    const toLinear = (v: number) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    let brightest = 0;
    for (let ty = y + 1; ty < y + h - 1; ty++) {
      for (let tx = x + Math.floor(w / 2); tx < x + w - 2; tx++) {
        const i = (ty * 2 * 480 + tx * 2) * 4;
        const rgb = [0, 1, 2].map((c) => toLinear(pixels[i + c]!)) as [number, number, number];
        brightest = Math.max(brightest, luminance(rgb));
      }
    }
    expect(brightest).toBeGreaterThan(0);
    expect(brightest).toBeLessThanOrEqual(ceiling + 0.01);
  });
});

describe('the hand cursor', () => {
  const palette = new Set(
    readFileSync('assets/palette/eightfold.hex', 'utf8')
      .trim()
      .split(/\s+/)
      .map((h) => h.toLowerCase()),
  );

  it('is a 16 x 12 grid in palette colours with hard alpha', () => {
    expect(HAND_SIZE).toEqual([16, 12]);
    expect(HAND.every((row) => row.length === 16 && /^[.ocsw]+$/.test(row))).toBe(true);
    const { width, height, data } = handPixels();
    expect([width, height]).toEqual([16, 12]);
    for (let i = 0; i < data.length; i += 4) {
      expect([0, 255]).toContain(data[i + 3]);
      if (data[i + 3] === 0) continue;
      const hex = [0, 1, 2].map((c) => data[i + c]!.toString(16).padStart(2, '0')).join('');
      expect(palette.has(hex), hex).toBe(true);
    }
  });

  it('turns into an SVG that covers exactly the opaque texels', () => {
    const covered = HAND.map((row) => [...row].map(() => false));
    for (const match of handSvg().matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)"/g)) {
      const [x, y, w] = match.slice(1).map(Number) as [number, number, number];
      for (let i = x; i < x + w; i++) {
        expect(covered[y]![i], `${i},${y}`).toBe(false);
        covered[y]![i] = true;
      }
    }
    HAND.forEach((row, y) =>
      [...row].forEach((cell, x) => expect(covered[y]![x], `${x},${y}`).toBe(cell !== '.')),
    );
    expect(handSvg()).toContain('shape-rendering="crispEdges"');
  });
});
