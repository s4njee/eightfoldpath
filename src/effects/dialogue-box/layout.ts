import type { NineSlice } from '../../gpu/text/index.ts';

/*
 * Where the dialogue box's parts go, in texels of the canvas (story 9.5). One layout drives both
 * halves of the component: the GPU draws the frame, portrait and marker at these rectangles, and
 * the DOM text and button are placed at the same rectangles in CSS pixels. The only input from the
 * DOM is how tall the text is once the browser has wrapped it.
 */

export type Rect = readonly [x: number, y: number, width: number, height: number];

/**
 * The parchment frame's corners and edges, read off assets/ui/window-frame.png: left, top, right,
 * bottom. Wider than the wood alone (7, 6, 7, 7) so the parchment's shaded rim goes with the edges;
 * only the plain middle of the parchment repeats, which keeps the repeat from showing as a grid.
 */
export const FRAME: NineSlice = { insets: [10, 8, 10, 9], width: 74, height: 51 };
/** assets/ui/traveller-bust.png. */
export const PORTRAIT_SIZE = [47, 53] as const;
/** The ▼ glyph of the bitmap font, drawn as the marker. */
export const MARKER_SIZE = [5, 3] as const;

/** Texels between the box and the canvas edge. */
const MARGIN = 6;
const MAX_WIDTH = 300;
/** Narrower than this and the portrait is left out, so the text keeps its room. */
const PORTRAIT_MIN_WIDTH = 150;
/** Inside the frame: left, top, right, bottom. A little more than the frame's own insets. */
const PADDING = [12, 10, 12, 11] as const;
const GAP = 7;
const SPEAKER_HEIGHT = 9;
/** Room kept at the right of the text for the marker. */
const MARKER_ROOM = 9;
/** The button's hit area around the marker, so it is at least 24 CSS pixels at two per texel. */
const BUTTON_SIZE = [16, 12] as const;

export interface DialogueLayout {
  readonly window: Rect;
  readonly portrait?: Rect;
  readonly speaker: Rect;
  readonly text: Rect;
  /** Where the marker is drawn, at rest. */
  readonly marker: Rect;
  /** The "next" button: the marker with a hit area round it. */
  readonly button: Rect;
}

/** Width of the text column for a canvas this wide, before the text has been measured. */
export function textColumnWidth(canvasWidth: number): number {
  return dialogueLayout(canvasWidth, 1000, 0).text[2];
}

/**
 * The box along the bottom of a `width` × `height` texel canvas, holding `textHeight` texels of
 * text. The box never shrinks below the portrait's height, so turning to a shorter page does not
 * make it jump (the DOM measures the tallest page anyway).
 */
export function dialogueLayout(width: number, height: number, textHeight: number): DialogueLayout {
  const [padLeft, padTop, padRight, padBottom] = PADDING;
  const boxWidth = Math.max(FRAME.width / 2, Math.min(width - 2 * MARGIN, MAX_WIDTH));
  const x = Math.floor((width - boxWidth) / 2);
  const portrait = boxWidth >= PORTRAIT_MIN_WIDTH;

  const textX = portrait ? x + padLeft + PORTRAIT_SIZE[0] + GAP : x + padLeft;
  const textWidth = Math.max(1, x + boxWidth - padRight - MARKER_ROOM - textX);
  const contentHeight = SPEAKER_HEIGHT + Math.max(0, Math.ceil(textHeight));
  const inner = Math.max(contentHeight, portrait ? PORTRAIT_SIZE[1] - 2 : 2 * SPEAKER_HEIGHT);
  const boxHeight = padTop + inner + padBottom;
  const y = Math.max(0, height - MARGIN - boxHeight);

  const marker: Rect = [
    x + boxWidth - padRight - MARKER_SIZE[0] + 1,
    y + boxHeight - padBottom - MARKER_SIZE[1] + 1,
    ...MARKER_SIZE,
  ];
  const button: Rect = [
    marker[0] - Math.floor((BUTTON_SIZE[0] - MARKER_SIZE[0]) / 2),
    marker[1] - Math.floor((BUTTON_SIZE[1] - MARKER_SIZE[1]) / 2),
    ...BUTTON_SIZE,
  ];
  return {
    window: [x, y, boxWidth, boxHeight],
    portrait: portrait
      ? [x + padLeft - 2, y + Math.floor((boxHeight - PORTRAIT_SIZE[1]) / 2), ...PORTRAIT_SIZE]
      : undefined,
    speaker: [textX, y + padTop, textWidth, SPEAKER_HEIGHT],
    text: [textX, y + padTop + SPEAKER_HEIGHT, textWidth, Math.max(1, inner - SPEAKER_HEIGHT)],
    marker,
    button,
  };
}
