import { describe, expect, it } from 'vitest';
import {
  dialogueLayout,
  FRAME,
  MARKER_SIZE,
  PORTRAIT_SIZE,
  textColumnWidth,
  type Rect,
} from '../src/effects/dialogue-box/layout.ts';
import {
  createDialogueState,
  markerBounce,
  revealedLength,
  revealSchedule,
  type DialogueSettings,
} from '../src/effects/dialogue-box/reveal.ts';
import { buildFontAtlas, layoutText, nineSliceQuads } from '../src/gpu/text/index.ts';
import { fitTexelScale, texelCss } from '../src/gpu/ui/overlay.ts';
import { mountHeadless } from './headless.ts';

const typing: DialogueSettings = { speed: 10, hold: 0, animate: true };
const reduced: DialogueSettings = { ...typing, animate: false };

const contains = (outer: Rect, inner: Rect) =>
  inner[0] >= outer[0] &&
  inner[1] >= outer[1] &&
  inner[0] + inner[2] <= outer[0] + outer[2] &&
  inner[1] + inner[3] <= outer[1] + outer[3];

/** The window's inside, past the frame's corners and edges. */
const interior = (window: Rect): Rect => {
  const [left, top, right, bottom] = FRAME.insets;
  return [window[0] + left, window[1] + top, window[2] - left - right, window[3] - top - bottom];
};

describe('the dialogue reveal', () => {
  it('pauses after punctuation, on the same clock as the bitmap font', () => {
    const schedule = revealSchedule('Hi. Yes, go');
    // H i . (pause 6) space Y e s , (pause 3) space g o
    expect(schedule.order).toEqual([0, 1, 2, 9, 10, 11, 12, 13, 17, 18, 19]);
    const glyphs = layoutText(buildFontAtlas(), 'Hi. Yes, go').glyphs.map((g) => g.order);
    expect(glyphs).toEqual(schedule.order.filter((_, i) => 'Hi. Yes, go'[i] !== ' '));
    expect(schedule.duration).toBe(layoutText(buildFontAtlas(), 'Hi. Yes, go').duration);
  });

  it('holds at a full stop: nothing new shows during the pause', () => {
    const schedule = revealSchedule('Hi. Yes');
    expect(revealedLength(schedule, 0)).toBe(0);
    expect(revealedLength(schedule, 2.5)).toBe(3);
    expect(revealedLength(schedule, 8.9)).toBe(3);
    expect(revealedLength(schedule, 9.5)).toBe(4);
    expect(revealedLength(schedule, schedule.duration)).toBe('Hi. Yes'.length);
  });

  it('never splits a surrogate pair', () => {
    const schedule = revealSchedule('a\u{1F56F}b');
    expect(schedule.ends).toEqual([1, 3, 4]);
    for (let clock = 0; clock <= schedule.duration; clock += 0.25) {
      expect([0, 1, 3, 4]).toContain(revealedLength(schedule, clock));
    }
  });

  it('types a page, finishes it on the first advance and turns on the second', () => {
    const state = createDialogueState(['Hello there.', 'Second page']);
    state.tick(0.3, typing);
    expect(state.revealed(typing)).toBe(3);
    expect(state.complete(typing)).toBe(false);
    expect(state.advance(typing)).toBe('finished');
    expect(state.revealed(typing)).toBe('Hello there.'.length);
    expect(state.advance(typing)).toBe('next');
    expect(state.page).toBe(1);
    expect(state.revealed(typing)).toBe(0);
    state.advance(typing);
    state.advance(typing);
    expect(state.page).toBe(0);
  });

  it('waits for the reader unless a hold is set', () => {
    const waits = createDialogueState(['Hi', 'There']);
    for (let i = 0; i < 100; i++) waits.tick(0.1, typing);
    expect(waits.page).toBe(0);
    const turns = createDialogueState(['Hi', 'There']);
    for (let i = 0; i < 25; i++) turns.tick(0.1, { ...typing, hold: 2 });
    expect(turns.page).toBe(1);
  });

  it('shows every page whole under reduced motion and turns on one press', () => {
    const state = createDialogueState(['A whole line at once.', 'And the next.']);
    expect(state.revealed(reduced)).toBe('A whole line at once.'.length);
    expect(state.complete(reduced)).toBe(true);
    state.tick(5, { ...reduced, hold: 1 });
    expect(state.page).toBe(0);
    expect(state.advance(reduced)).toBe('next');
    expect(state.revealed(reduced)).toBe('And the next.'.length);
  });

  it('bounces the marker a whole texel at a time, and not at all under reduced motion', () => {
    const steps = Array.from({ length: 60 }, (_, i) => markerBounce(i / 30, true));
    expect(new Set(steps)).toEqual(new Set([0, 1, 2]));
    for (let i = 1; i < steps.length; i++) {
      expect(Math.abs(steps[i]! - steps[i - 1]!)).toBeLessThanOrEqual(1);
    }
    expect(markerBounce(0.2, true)).toBe(markerBounce(1.2, true));
    expect(Array.from({ length: 30 }, (_, i) => markerBounce(i / 30, false))).toEqual(
      Array(30).fill(0),
    );
  });
});

describe('the dialogue layout', () => {
  it('keeps the box on the canvas and the text inside the frame', () => {
    for (const [width, height] of [
      [320, 180],
      [195, 420],
      [640, 360],
      [100, 60],
    ] as const) {
      const layout = dialogueLayout(width, height, 30);
      expect(contains([0, 0, width, height], layout.window), `${width}x${height}`).toBe(true);
      for (const part of [layout.speaker, layout.text, layout.marker]) {
        expect(contains(interior(layout.window), part), `${width}x${height}`).toBe(true);
      }
      expect(contains(layout.button, layout.marker)).toBe(true);
      // The text column the DOM is measured at is the one it is placed in.
      expect(textColumnWidth(width)).toBe(layout.text[2]);
    }
  });

  it('shows the portrait only where there is room, inside the frame', () => {
    const wide = dialogueLayout(320, 180, 30);
    expect(wide.portrait).toBeDefined();
    expect(contains(interior(wide.window), wide.portrait!)).toBe(true);
    expect(wide.text[0]).toBeGreaterThanOrEqual(wide.portrait![0] + PORTRAIT_SIZE[0]);
    expect(dialogueLayout(120, 180, 30).portrait).toBeUndefined();
  });

  it('grows with the text but never shrinks below the portrait', () => {
    const short = dialogueLayout(320, 300, 5);
    const tall = dialogueLayout(320, 300, 80);
    expect(short.window[3]).toBe(dialogueLayout(320, 300, 0).window[3]);
    expect(tall.window[3] - short.window[3]).toBeGreaterThan(30);
    expect(tall.text[3]).toBeGreaterThanOrEqual(80);
    // Bottom-anchored: the box grows upwards.
    expect(tall.window[1] + tall.window[3]).toBe(short.window[1] + short.window[3]);
    expect(MARKER_SIZE).toEqual([5, 3]);
  });

  it('draws the frame as nine whole-texel slices, or eight without the middle', () => {
    const quads = nineSliceQuads(FRAME, 1, [4, 4, 100, 60], 3);
    expect(quads).toHaveLength(9);
    for (const quad of quads) {
      for (const value of quad.dst) expect(value % 3).toBe(0);
    }
    // The corners are copied at their own size and the edges fill the rest exactly.
    const [left, top, right] = FRAME.insets;
    expect(quads[0]!.dst).toEqual([12, 12, left * 3, top * 3]);
    expect(quads[1]!.dst[2]).toBe((100 - left - right) * 3);
    const open = nineSliceQuads(FRAME, 1, [4, 4, 100, 60], 3, undefined, false);
    expect(open).toHaveLength(8);
    expect(open.some((quad) => quad.src[0] === left && quad.src[1] === top)).toBe(false);
  });
});

describe('the texel scale over a page', () => {
  it('is a whole number of canvas pixels, about three CSS pixels wide or two narrow', () => {
    expect(fitTexelScale(1280, 1)).toBe(3);
    expect(fitTexelScale(2560, 2)).toBe(6);
    expect(fitTexelScale(780, 2)).toBe(4);
    expect(texelCss(fitTexelScale(780, 2), 2)).toBe(2);
    // At a fractional ratio it stays whole in canvas pixels, which is what keeps texels square.
    expect(Number.isInteger(fitTexelScale(1500, 1.25))).toBe(true);
    // Never so big that the canvas is a handful of texels across.
    expect(fitTexelScale(48, 1)).toBe(1);
  });
});

describe('the dialogue-box effect without a DOM', () => {
  it('draws its own copy of the text, typed out, and the whole of it with the typewriter off', async () => {
    const pixels = async (params: Record<string, unknown>, seconds: number) => {
      const mounted = await mountHeadless('dialogue-box', { width: 480, height: 270, params });
      await mounted.runTo(seconds);
      const out = await mounted.read();
      mounted.destroy();
      return out;
    };
    const early = await pixels({}, 0.2);
    const later = await pixels({}, 1.5);
    const whole = await pixels({ typewriter: false }, 0.2);
    const differs = (a: Uint8Array, b: Uint8Array) => a.some((value, i) => value !== b[i]);
    expect(differs(early, later)).toBe(true);
    expect(differs(early, whole)).toBe(true);
  });
});
