## How it works

Menu windows in the HD-2D style: frames of pixel art over frosted glass, a blurred and tinted copy of the scene behind them, with a pointing hand on the chosen item. The menu itself is real HTML.

**The backdrop is a still.** The village diorama (`src/gpu/diorama/stage.ts`, the scene in `src/effects/diorama/village.ts`) is drawn once into an `rgba16float` still, with the sun's shadows and 4× multisampling because it is drawn only once. The still is halved two times by default (`downsample`, the 13-tap filter that weighs every source texel equally) and blurred at that quarter size with the shared separable Gaussian (`src/gpu/passes/blur.ts`). None of this runs again until the canvas changes size or the blur settings change, and the multisampled targets (about 100 MB at 1080p) are released on the frame after the still is drawn. With `scene` set to `live` the diorama is drawn every frame with its camera swaying, without shadows or multisampling, and then the cost is the stage's (Tier B territory).

**Each frame is one fullscreen pass** (`menu.wgsl`). Outside the windows it shows the still, tonemapped. Inside them it shows the blurred copy, bilinearly enlarged for free, tonemapped, mixed towards the tint, and then scaled down wherever it is brighter than a luminance ceiling. The ceiling is worked out from the menu's text colours and the `contrast` parameter (`glassCeiling` in `layout.ts`, from WCAG's contrast formula): at the default 4.5 the glass can never be bright enough to drop the cream and gold text below 4.5:1, whatever part of the scene is behind it. The glass and a two-texel drop shadow end on whole texels, the same grid as the frames.

**The frames** are the wooden border of `assets/ui/window-frame.png` as a nine-slice with its middle left out (`nineSliceQuads(..., centre = false)`, insets 7, 6, 7 and 6), drawn by the pixel-quad renderer from story 3.10 with the portrait in the same draw. GPU frames rather than a CSS `border-image` was a choice made on three grounds: the texel scale is a whole number of canvas pixels (`fitTexelScale`), so the border stays square-texelled at fractional device pixel ratios where a border-image slice is resampled; the glass under the frame comes from the canvas the effect owns, which CSS `backdrop-filter` would blur again at full resolution every time the canvas changed; and the inspector, the loupe and the poster see the whole window. The CSS fallback makes the other choice and shows the difference.

**The menu is HTML** (`dom.ts`), placed at the texel layout (`menuLayout`) in CSS pixels. The commands are `<button role="menuitem">`s in a `role="menu"` list with a roving tabindex: one tab stop, up and down (wrapping), Home and End, and a letter to jump to the next item starting with it (`moveCursor`). Enter and Space choose, through the buttons themselves, and the choice is written into the message window, a polite live region. Pointing at an item moves the hand there, and takes the focus with it only if the menu already has it. "Save" is `aria-disabled` and still reachable, as the ARIA pattern asks. The party window is a labelled group of plain text.

**The hand is HTML too**: an SVG built from the 16 × 12 pixel grid in `cursor.ts`, placed in whole texels. It has to move the instant a key is pressed, and the canvas is redrawn only while the host's frame loop runs, which under reduced motion it does not, so a hand drawn on the GPU would lag a frame or be left behind. It snaps to the active item and nudges one texel twice a second; under reduced motion the nudge stops. The focused item also turns gold and is underlined while the menu has keyboard focus, so focus is never shown by the hand alone.

**Without a DOM** (the headless tests, the poster) the canvas draws the labels, the stats and the message in the Wayfarer bitmap font and the hand from the same grid, so a still of the effect still shows a menu. A canvas inside a link or an `aria-hidden` or `inert` subtree (a gallery thumbnail) gets an inert overlay.

**The CSS fallback** (story 12.5) is `mountCssMenu`, exported with the effect: the same buttons, keys and messages, laid out by CSS grid, with the border as a `border-image` with no `fill`, the glass as `backdrop-filter: blur() brightness()` over a translucent tint, and the hand as the same SVG. Its stylesheet is `MENU_CSS` (`style.ts`).

The inspector's views show the still alone, the blurred copy alone and the quads; its stages turn off the blur, the tint (and the ceiling with it), the drop shadow, the frames, the portrait and the hand.

## Cost

**Study** (`npm run study -- --epic 9`, [docs/studies/epic-9.md](../../../docs/studies/epic-9.md), Apple M1 Max on Dawn, marginal cost per frame with the tail, at the defaults): **0.50 ms at 1920 × 1080 and 0.20 ms at 1266 × 585**. Loads this light sit near Apple Silicon's timing floor, so differences under about half a millisecond are noise; nothing has been measured on an integrated GPU or a phone, where the tier budgets are set.

Not measured on an integrated GPU yet, and not run through `npm run study`. One reading from the HUD in `npm run browser-check`, at 1920 × 1080 on an Apple M1 Max while other GPU work was running, so indicative only: 0.48 to 0.56 ms a frame with the still (the glass pass about 0.35 ms, the output pass about 0.5 ms, overlapping on a tile-based GPU). The diorama, its shadow map, the downsamples and the blur are paid only when the canvas changes size. Texture memory at 1080p is about 62 MB by the HUD's count, most of it the full-size `rgba16float` still and the tail's scene target (16 MB each) and the stage's shadow map; while a still is being drawn it briefly adds the multisampled targets. In `live` mode the stage runs every frame and the effect is no longer Tier A.

## Pitfalls

- **The glass is the effect's own canvas, not the page.** The blurred copy is of the diorama the effect draws; it cannot blur arbitrary page content (story 12.5's CSS fallback can, with `backdrop-filter`).
- **Tonemapping moved into the glass pass.** The ceiling has to be applied to the colour the reader sees, so the still and the glass are tonemapped (ACES) in `menu.wgsl` and the output pass only encodes. Bloom is off for the same reason: it would brighten the glass after the ceiling.
- **Big still.** The still is a full-size `rgba16float` target; halving it to `rgba8unorm` after tonemapping would save 12 MB at 1080p and is not done yet.
- **The DOM is placed from a layout.** A page that moves the buttons with its own CSS breaks their alignment with the frames; restyle through the custom properties in `style.ts` instead.
- **Typeahead is one letter.** A second letter typed quickly jumps again rather than refining the match, which is simpler than the ARIA pattern's buffered typeahead.
- **The narrow layout stacks** the windows, and on a phone the party window and commands cover most of the scene.

## When to use it

Settings, pause and command menus in a game-styled site, a navigation or account panel over a pixel-art hero, or any panel of text over a busy scene that must stay legible. With the still it is Tier A (provisional until measured on an integrated GPU) and fine on phones; with `live` it is a Tier B set piece. Without WebGPU, or over page content rather than a scene the effect draws, use `mountCssMenu`.

## References

- W3C WAI-ARIA Authoring Practices, _Menu and Menubar pattern_: <https://www.w3.org/WAI/ARIA/apg/patterns/menubar/>
- W3C, _WCAG 2.2: 1.4.3 Contrast (Minimum) and the relative luminance and contrast ratio definitions_: <https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio>
- Jorge Jimenez, _Next Generation Post Processing in Call of Duty: Advanced Warfare_ (the 13-tap downsample), SIGGRAPH 2014: <https://www.iryoku.com/next-generation-post-processing-in-call-of-duty-advanced-warfare/>
- MDN, _backdrop-filter_: <https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter>
- Nine-slice scaling: <https://en.wikipedia.org/wiki/9-slice_scaling>
