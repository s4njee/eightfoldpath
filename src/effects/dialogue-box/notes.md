## How it works

A dialogue box in the HD-2D style that is also a real web component: the pixel art is drawn on the GPU, and everything a reader, a keyboard or a screen reader has to meet is HTML laid over it.

**The split.** The canvas draws what has to be pixel art: the parallax backdrop, the light round the window, the nine-slice frame, the portrait and the bouncing ▼ marker, all at one whole-number texel scale so every texel is the same square of device pixels. The DOM holds the speaker's name, the line and the "next" button. Drawing the frame on the GPU rather than as a CSS `border-image` (the gallery's Dialogue layout, story 2.6, and the CSS fallback here) keeps it exact: the scale is chosen in canvas pixels (`fitTexelScale` in `src/gpu/ui/overlay.ts`, about three CSS pixels a texel on a wide canvas and two on a narrow one), so at a device pixel ratio of 1.25 or 1.5 the texels stay square, where a border-image slice scaled in CSS pixels is resampled unevenly. It also puts the frame, the light and the backdrop in one render pass, and lets the inspector, the loupe and the poster see the window.

**One layout for both halves.** `layout.ts` places the window, portrait, speaker, text, marker and button in texels along the bottom of the canvas. The effect places the DOM at the same rectangles in CSS pixels (`placeAt`) and draws the frame from the same numbers, so the two cannot drift apart. The DOM's one input to the layout is how tall the text is once the browser has wrapped it: `dom.ts` keeps every page of the script stacked in one hidden grid cell (the sizer), so the box is as tall as the tallest page from the start and never moves while a line types or a page turns. A `ResizeObserver` measures again if wrapping changes (a zoom, a web font).

**The reveal.** The whole line is in the DOM from the first frame, as one text node in a polite live region (`aria-live="polite"`, `aria-atomic`). The typewriter only hides the part not yet reached, with a CSS Custom Highlight (`::highlight(efp-dialogue-pending) { color: transparent }`) over a `Range` that is moved forward each frame. Nothing is inserted character by character, so a screen reader hears each line once and whole when the page turns, selection and find-in-page see the full line, nothing reflows as it types, and a machine translation of the page still works. The clock (`reveal.ts`) is the bitmap font's (story 3.10): one unit per character with the same pauses after punctuation, shared through `PUNCTUATION_PAUSES` in `src/gpu/text/layout.ts`. A browser without the Highlight API shows every line whole.

**Advancing.** The button is a real `<button>` (Enter and Space come with it), and a click anywhere on the window counts too, unless it ends a text selection. The first press finishes a line that is still typing; the next turns the page; the last page wraps to the first. The button's accessible name says which it will do. `hold` turns finished pages by themselves; it is off by default, so the reader sets the pace (WCAG 2.2.1).

**Reduced motion.** `watchMotion` follows `prefers-reduced-motion` and the gallery's motion choice. With motion off every line is shown whole, presses turn pages at once, and the marker stops bouncing; the host stops the frame loop anyway, so the DOM is brought up to date without waiting for a frame.

**The light** (`dialogue.wgsl`): one fullscreen pass, blended premultiplied between the backdrop and the frame, with a scrim that darkens the scene from a little above the window and a warm halo just outside it that breathes over about five seconds. Both are evaluated at texel centres and rounded into a few bands, so they land on the pixel grid the way the art's own shading does. With `backdrop` set to `page` the canvas is see-through and the scrim dims the page itself behind the box.

**Without a DOM** (the headless tests, the poster) the canvas draws the speaker and the line itself in the Wayfarer bitmap font, revealed on the same clock, so a still still reads as a dialogue box. A canvas inside a link or an `aria-hidden` or `inert` subtree (a gallery thumbnail) gets an inert overlay, so a card never grows a button.

**The CSS fallback** (story 12.5) is `mountCssDialogue`, exported with the effect: the same HTML, reveal and keys, with the frame as a nine-slice `border-image` whose edges and middle repeat rather than stretch, the portrait as an image and the marker as a glyph with a stepped CSS bounce, laid out by CSS alone. Its stylesheet is `DIALOGUE_CSS` (`style.ts`).

The inspector's views show the quads and the slots the DOM is placed in; its stages turn off the backdrop, scrim, glow, shadow, frame, portrait and typewriter.

## Cost

**Study** (`npm run study -- --epic 9`, [docs/studies/epic-9.md](../../../docs/studies/epic-9.md), Apple M1 Max on Dawn, marginal cost per frame with the tail, at the defaults): **0.37 ms at 1920 × 1080 and 0.20 ms at 1266 × 585**. Loads this light sit near Apple Silicon's timing floor, so differences under about half a millisecond are noise; nothing has been measured on an integrated GPU or a phone, where the tier budgets are set.

Not measured on an integrated GPU yet, and not run through `npm run study`. One reading from the HUD in `npm run browser-check`, at 1920 × 1080 on an Apple M1 Max while other GPU work was running, so indicative only: 0.35 to 0.40 ms a frame (the dialogue pass about 0.21 ms, the output pass about 0.32 ms; on a tile-based GPU they overlap). The work is one render pass of a few dozen quads and one fullscreen triangle, plus the HDR tail's output pass with bloom off, so it should stay well inside Tier A's 2 ms; it scales with the canvas's pixel count only through the fullscreen light and the output.

Memory: a 137 × 76 × 7 `rgba8unorm-srgb` texture array (the font atlas, frame, portrait and four backdrop layers, about 290 kB) and the tail's `rgba16float` scene target. CPU: laying out the box is done on resize; per frame it is one `Range` update and a uniform write.

## Pitfalls

- **The DOM is placed from a layout, not read back.** If a page restyles the overlay's text (a larger `--efp-dialogue-font`), the box grows to fit because the text is measured, but a page that moves the elements with its own CSS breaks the alignment with the frame.
- **One frame late on a font change.** A re-measure from the `ResizeObserver` moves the DOM at once; the canvas follows on the next frame. Under reduced motion, with the loop stopped, the canvas follows on the next redraw. System fonts are used by default, so this only bites with a web font.
- **The CSS Custom Highlight API is recent** (Chrome 105, Safari 17.2, Firefox 140). Without it the effect shows lines whole rather than inserting text, which would make a live region announce fragments.
- **A press while typing finishes the line rather than turning the page.** That is the game convention and what sighted keyboard users expect, but a screen reader user, who already has the whole line, has to press twice. The button's name says which it will do.
- **The texel scale is chosen in canvas pixels.** If the host's resolution scale or DPR cap leaves fewer canvas pixels than device pixels, the texels are still square but the browser scales the canvas; the DOM text stays sharp.
- **The parchment repeats.** Only the plain middle of the frame art repeats (insets of 10, 8, 10 and 9 texels rather than the wood's 7, 6, 7, 7), because repeating its shaded rim showed as a grid.

## When to use it

Onboarding tips, tours, help text and story pages in a game-styled product, or a dialogue box over a pixel-art hero. It is Tier A (provisional until measured on an integrated GPU) and safe on ordinary pages because the text is HTML. Where WebGPU is not available, or the box sits over something the effect does not draw, use `mountCssDialogue`. For text that is part of the picture rather than read (signs, damage numbers), draw it with the bitmap font (`bitmap-text`) instead.

## References

- W3C, _CSS Custom Highlight API_: <https://www.w3.org/TR/css-highlight-api-1/>
- MDN, _ARIA live regions_: <https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/ARIA_Live_Regions>
- W3C, _WCAG 2.2: 2.2.1 Timing Adjustable and 2.3.3 Animation from Interactions_: <https://www.w3.org/TR/WCAG22/>
- MDN, _border-image_: <https://developer.mozilla.org/en-US/docs/Web/CSS/border-image>
- Nine-slice scaling: <https://en.wikipedia.org/wiki/9-slice_scaling>
