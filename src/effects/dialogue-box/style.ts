/*
 * The dialogue box's stylesheet (story 9.5), as a string so the effect can add it to whatever
 * document its canvas is in without a bundler's CSS handling (the library build has none).
 *
 * Two skins share it. `--canvas`: the GPU draws the frame, portrait and marker, and the DOM only
 * holds the text and the button, placed from the texel layout. `--css`: the fallback for a page
 * without WebGPU (story 12.5), the window frame as a nine-slice `border-image`, the portrait as an
 * image and the marker as a glyph, laid out by CSS alone.
 *
 * A page can restyle the text through custom properties:
 *   --efp-dialogue-font     the `font` shorthand for the line
 *   --efp-dialogue-ink      the text colour (dark: the window is parchment)
 *   --efp-dialogue-accent   the speaker's name and the marker
 */

export const DIALOGUE_STYLE_ID = 'efp-dialogue-style';
/** The CSS Custom Highlight that hides the part of a line the typewriter has not reached. */
export const PENDING_HIGHLIGHT = 'efp-dialogue-pending';

export const DIALOGUE_CSS = `
.efp-dialogue {
  --efp-texel: 3px;
  color: var(--efp-dialogue-ink, #42261e);
  font: var(--efp-dialogue-font, 500 max(15px, calc(var(--efp-texel) * 6.5)) / 1.4 ui-serif, Georgia, 'Times New Roman', serif);
}
.efp-dialogue__window {
  pointer-events: auto;
  box-sizing: border-box;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.efp-dialogue__speaker {
  margin: 0;
  overflow: hidden;
  color: var(--efp-dialogue-accent, #750c17);
  font: 700 max(12px, calc(var(--efp-texel) * 4.5)) / 1 ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
}
/* The live line and the sizer share one grid cell: the sizer holds every page, so the box is as
   tall as the tallest one from the start and never moves while a line types or a page turns. */
.efp-dialogue__text {
  display: grid;
  margin: 0;
}
.efp-dialogue__text > * {
  grid-area: 1 / 1;
  margin: 0;
}
.efp-dialogue__sizer {
  display: grid;
  visibility: hidden;
}
.efp-dialogue__sizer > * {
  grid-area: 1 / 1;
}
::highlight(${PENDING_HIGHLIGHT}) {
  color: transparent;
}
.efp-dialogue__next {
  position: absolute;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--efp-dialogue-accent, #750c17);
  font: inherit;
  cursor: pointer;
}
.efp-dialogue__next:focus-visible {
  outline: max(2px, var(--efp-texel)) solid var(--efp-dialogue-accent, #750c17);
  outline-offset: 0;
}

/* The canvas skin: everything is placed by the effect; only text and focus are drawn here. */
.efp-dialogue--canvas .efp-dialogue__window {
  position: absolute;
}
.efp-dialogue--canvas .efp-dialogue__next > span {
  display: none;
}

/* The CSS skin (no WebGPU): a self-contained box along the bottom of its container. */
.efp-dialogue--css {
  position: absolute;
  inset: auto 0 0;
  display: flex;
  justify-content: center;
  padding: calc(var(--efp-texel) * 6);
  pointer-events: none;
}
.efp-dialogue--css .efp-dialogue__window {
  position: relative;
  display: flex;
  align-items: center;
  gap: calc(var(--efp-texel) * 7);
  width: min(100%, calc(var(--efp-texel) * 300));
  min-height: calc(var(--efp-texel) * 68);
  padding: calc(var(--efp-texel) * 2) calc(var(--efp-texel) * 10) calc(var(--efp-texel) * 2)
    calc(var(--efp-texel) * 2);
  border: solid transparent;
  border-width: calc(var(--efp-texel) * 8) calc(var(--efp-texel) * 10) calc(var(--efp-texel) * 9);
  /* The frame's insets (layout.ts: 8 texels at the top, 9 at the bottom, 10 at the sides). Edges
     and middle repeat rather than stretch, as on the GPU, so the texels stay square. */
  border-image: var(--efp-dialogue-frame) 8 10 9 fill / calc(var(--efp-texel) * 8)
    calc(var(--efp-texel) * 10) calc(var(--efp-texel) * 9) / 0 repeat;
  image-rendering: pixelated;
}
.efp-dialogue--css .efp-dialogue__portrait {
  flex: none;
  width: calc(var(--efp-texel) * 47);
  height: calc(var(--efp-texel) * 53);
  image-rendering: pixelated;
}
.efp-dialogue--css .efp-dialogue__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: calc(var(--efp-texel) * 2);
  min-width: 0;
}
.efp-dialogue--css .efp-dialogue__next {
  right: calc(var(--efp-texel) * 2);
  bottom: 0;
  width: max(24px, calc(var(--efp-texel) * 12));
  height: max(24px, calc(var(--efp-texel) * 10));
  font-size: max(12px, calc(var(--efp-texel) * 5));
  line-height: 1;
}
.efp-dialogue--css .efp-dialogue__next > span {
  display: inline-block;
  visibility: hidden;
}
.efp-dialogue--css [data-complete] .efp-dialogue__next > span {
  visibility: visible;
}
.efp-dialogue--css[data-animate] [data-complete] .efp-dialogue__next > span {
  animation: efp-dialogue-bounce 1s steps(1, end) infinite;
}
@keyframes efp-dialogue-bounce {
  0%, 33% { transform: translateY(0); }
  34%, 49% { transform: translateY(calc(var(--efp-texel) * -1)); }
  50%, 83% { transform: translateY(calc(var(--efp-texel) * -2)); }
  84%, 100% { transform: translateY(calc(var(--efp-texel) * -1)); }
}
@media (max-width: 520px) {
  .efp-dialogue--css { --efp-texel: 2px; }
  .efp-dialogue--css .efp-dialogue__portrait { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .efp-dialogue__next > span { animation: none !important; }
}
`;
