## How it works

Bitmap text is text drawn from a pixel font: each glyph a small grid of texels, scaled up by a whole number so every texel becomes a square block of screen pixels. The shared code is in `src/gpu/text/`; this effect is a title card and a dialogue box over a parallax backdrop.

1. **The font is data.** `font.ts` holds _Wayfarer 5×7_, an original font drawn for this repository (MIT): capitals and digits 5 × 7 texels, a 5-row x-height with 2-row ascenders and descenders, every printable ASCII character plus `’ — … ▼`. Glyphs are rows of `#` and `.`, so the font can be read and edited in the source.
2. **Atlas at load.** `buildFontAtlas` (`atlas.ts`) draws every glyph into a 96 × 70 image of white ink with alpha 0 or 255, trimming each glyph to its ink so the text is proportional (an `i` is 3 texels wide, an `m` 5). The atlas is packed into the same texture array as the art.
3. **Layout in whole texels.** `layoutText` (`layout.ts`) places glyphs at integer texel positions with word wrap and explicit line breaks. Multiplying integer positions by an integer scale keeps every glyph texel on the pixel grid, which is the whole trick to crisp bitmap text.
4. **Typewriter.** Layout gives each glyph an `order`, the moment it appears in characters typed, with pauses after punctuation. The renderer collapses any glyph whose order is past the reveal clock, so revealing text is one uniform per frame; the clock is `characters per second` × time, and the page holds and turns. The "more" marker bobs by one texel rather than blinking.
5. **Pixel quads.** `createPixelQuads` (`quads.ts`, `pixel-quads.wgsl`) draws screen-space rectangles that copy texels from the array at a whole-number scale, repeating the source when the destination is larger. Glyphs, the drop shadow, the nine-slice window frame (edges and centre repeat instead of stretching), the portrait and the tiled backdrop are all quads in one instanced draw, with `textureLoad` and an alpha discard, so nothing is ever filtered.

The scale fits the canvas (a 240 × 135-texel design) unless set; the title is drawn at twice the text scale when it fits across. The dialogue box grows to hold its page at large scales, and the title card steps aside when the box needs its room. The inspector shows the atlas and the quads themselves; its stages turn off the typewriter, the shadow and the frame.

## Cost

Not measured yet. A cost run on an M1 Max (Dawn, 1080p) was taken while other GPU work was running and was inside the noise, so it is not recorded. The work is one instanced draw of about 300 quads, each covering only its own pixels, plus the HDR tail. Memory: a 137 × 76 × 7 `rgba8unorm-srgb` array (290 kB) for the atlas, frame, portrait and four backdrop layers.

## Pitfalls

- **Integer scale means device pixels.** The scale is in canvas pixels. At a device pixel ratio of 1.5 a scale of 3 is 2 CSS pixels per texel and stays crisp, but a scale chosen in CSS pixels and multiplied by a fractional DPR would not be whole. Not yet checked in a browser at fractional DPR.
- **No clipping.** Text that does not fit is not clipped; the box grows to hold it instead, which makes the box change height between pages at large scales.
- **Reduced motion freezes the reveal where it is.** The shell pauses the whole loop under `prefers-reduced-motion`, so a page can stop half typed. A host that knows motion is reduced should set `typewriter` off, which shows each page whole.
- **Canvas text is invisible to assistive technology.** A real dialogue box needs the same text in the DOM (the gallery's Dialogue layout does this).
- **Small character set.** ASCII and four extras; anything else draws as `?`. No kerning: pairs like `Te` keep a full space.
- **`target` is a reserved word in WGSL**, which broke the first uniform struct here; the field is `viewport`.

## When to use it

Dialogue boxes, signs, title cards, damage numbers and labels that should look like the pixel art around them and be drawn in the same pass. It is cheap enough for Tier A. For body text a reader must select, translate or hear, use HTML with a pixel web font instead, and keep this for text that is part of the picture.

## References

- W3C, _WGSL_: `textureLoad` and integer texture formats: <https://www.w3.org/TR/WGSL/>
- Nine-slice scaling, the frame technique: <https://en.wikipedia.org/wiki/9-slice_scaling>
