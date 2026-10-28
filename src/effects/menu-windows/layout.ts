import type { NineSlice } from '../../gpu/text/index.ts';
import { HAND_SIZE } from './cursor.ts';

/*
 * Where the menu windows go, how the cursor moves between items, and how dark the glass behind the
 * text has to be (story 9.6). Pure functions, so the tests can check them without a GPU or a DOM.
 */

export type Rect = readonly [x: number, y: number, width: number, height: number];

/**
 * The wooden border of assets/ui/window-frame.png, without its parchment: left, top, right,
 * bottom. The middle is left out when drawing, so the blurred scene shows through.
 */
export const BORDER: NineSlice = { insets: [7, 6, 7, 6], width: 74, height: 51 };

/** Texels from the canvas edge, and between windows. */
const MARGIN = 8;
const GAP = 6;
/** Inside a window, past its border. */
const PADDING = 9;
const COMMAND_WIDTH = 82;
export const ROW_HEIGHT = 13;
const MESSAGE_HEIGHT = 2 * PADDING + ROW_HEIGHT;
/** The portrait in the party window: assets/ui/traveller-bust.png. */
export const PORTRAIT_SIZE = [47, 53] as const;
/** Narrower than this and the windows stack instead of sitting side by side. */
const SIDE_BY_SIDE = MARGIN * 2 + COMMAND_WIDTH + GAP + 120;

export interface MenuLayout {
  readonly commands: Rect;
  readonly party: Rect;
  readonly message: Rect;
  /** One row per command, where its button goes. */
  readonly items: readonly Rect[];
  /** The party window's portrait (when it fits) and its text. */
  readonly portrait?: Rect;
  readonly stats: Rect;
  /** The message window's line. */
  readonly line: Rect;
}

/** The three windows on a `width` × `height` texel canvas, with `count` commands. */
export function menuLayout(width: number, height: number, count: number): MenuLayout {
  const commandHeight = 2 * PADDING + count * ROW_HEIGHT;
  const message: Rect = [
    MARGIN,
    Math.max(MARGIN, height - MARGIN - MESSAGE_HEIGHT),
    Math.max(1, width - 2 * MARGIN),
    MESSAGE_HEIGHT,
  ];
  let commands: Rect;
  let party: Rect;
  if (width >= SIDE_BY_SIDE) {
    commands = [MARGIN, MARGIN, COMMAND_WIDTH, commandHeight];
    const x = MARGIN + COMMAND_WIDTH + GAP;
    party = [x, MARGIN, Math.min(width - MARGIN - x, 200), commandHeight];
  } else {
    const full = Math.max(1, width - 2 * MARGIN);
    commands = [MARGIN, MARGIN, full, commandHeight];
    party = [MARGIN, MARGIN + commandHeight + GAP, full, 2 * PADDING + 4 * ROW_HEIGHT];
  }

  const [cx, cy, cw] = commands;
  const labelX = cx + PADDING + HAND_SIZE[0] + 2;
  const items = Array.from({ length: count }, (_, i): Rect => [
    labelX,
    cy + PADDING + i * ROW_HEIGHT,
    cx + cw - PADDING - labelX,
    ROW_HEIGHT,
  ]);

  const [px, py, pw, ph] = party;
  const portrait = pw >= 150 && ph >= PORTRAIT_SIZE[1] + 2 * PADDING - 6;
  const statsX = portrait ? px + PADDING + PORTRAIT_SIZE[0] + GAP : px + PADDING;
  return {
    commands,
    party,
    message,
    items,
    portrait: portrait
      ? [px + PADDING - 2, py + Math.floor((ph - PORTRAIT_SIZE[1]) / 2), ...PORTRAIT_SIZE]
      : undefined,
    stats: [statsX, py + PADDING, Math.max(1, px + pw - PADDING - statsX), ph - 2 * PADDING],
    line: [message[0] + PADDING, message[1] + PADDING, message[2] - 2 * PADDING, ROW_HEIGHT],
  };
}

/** Where the hand points at item `index`: just left of its label, centred on the row. */
export function cursorRect(layout: MenuLayout, index: number, nudge = 0): Rect {
  const item = layout.items[Math.min(Math.max(index, 0), layout.items.length - 1)]!;
  return [
    item[0] - HAND_SIZE[0] - 2 + nudge,
    item[1] + Math.floor((ROW_HEIGHT - HAND_SIZE[1]) / 2),
    ...HAND_SIZE,
  ];
}

/**
 * The item a key moves the cursor to, following the ARIA menu pattern: up and down wrap round,
 * Home and End go to the ends, and a letter goes to the next item starting with it. Undefined for
 * any other key, which the menu then leaves alone.
 */
export function moveCursor(
  index: number,
  key: string,
  labels: readonly string[],
): number | undefined {
  const count = labels.length;
  if (count === 0) return undefined;
  switch (key) {
    case 'ArrowDown':
      return (index + 1) % count;
    case 'ArrowUp':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
  }
  if (key.length !== 1 || !/\p{L}|\p{N}/u.test(key)) return undefined;
  const letter = key.toLocaleLowerCase();
  for (let step = 1; step <= count; step++) {
    const next = (index + step) % count;
    if (labels[next]!.toLocaleLowerCase().startsWith(letter)) return next;
  }
  return undefined;
}

/** The hand's idle nudge towards the item, in whole texels: one texel, twice a second. */
export function cursorNudge(seconds: number, animate: boolean): number {
  return animate ? Math.floor(seconds * 4) % 2 : 0;
}

/** Relative luminance (WCAG) of a linear RGB colour. */
export function luminance(rgb: readonly [number, number, number]): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/**
 * The brightest the glass behind text of luminance `text` may be for a contrast ratio of at least
 * `ratio` (WCAG 2: (L1 + 0.05) / (L2 + 0.05)). The shader scales any brighter pixel down to it, so
 * the text stays legible over whatever part of the scene is behind the window.
 */
export function glassCeiling(text: number, ratio: number): number {
  return Math.min(1, Math.max(0, (text + 0.05) / Math.max(1, ratio) - 0.05));
}
