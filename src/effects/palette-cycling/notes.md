## How it works

Palette cycling is how 8- and 16-bit games animated water, lava and glowing signs for free: the background is stored as palette indices, and the game rotates the colours of a few palette entries every few frames. Every pixel that uses those entries changes at once, so bands appear to flow without redrawing a pixel.

This does the same in one fragment shader:

1. **Indexing at load.** `indexImage` (`src/gpu/palette/indexed.ts`) turns each image into one byte per texel: the index of the nearest colour (in OKLab) of a small palette built from the image itself, with transparency as index 255. The colours that should cycle are listed per image in `index.ts`, dark to light, and placed first in that palette, so a cycling range is just a start and a length. Both images are already palette art, so every texel matches its colour exactly; the nearest-colour step matters for art that is not.
2. **Textures.** The indices go into an `r8uint` texture array (one layer per image, 20 kB for both), the palettes into one row each of a small `rgba8unorm-srgb` texture.
3. **Fragment shader** (`palette-cycling.wgsl`). Each pixel finds the texel it covers at a whole-number scale, loads its index, rotates it inside the range with `palette_cycle_index` (`src/wgsl/palette.wgsl`) by the image's phase, and loads the colour. Optional blending mixes towards the next step for smooth motion.
4. **Flow.** The waterfall's streaks run down the fall, along the flow, so rotating them as drawn makes whole sheets of water change colour in place. In `by row` mode each texel row lags half a step behind the one above, so the colour bands travel down the fall. The lava's bands already run across its flow, so it cycles as drawn.

Under each image a strip shows its palette as it rotates, with the cycling range underlined. The inspector shows the raw indices and which texels cycle; its stages stop the waterfall and the lava separately.

## Cost

Not measured yet. A cost run on an M1 Max (Dawn, 1080p) was taken while other GPU work was running and was inside the noise, so it is not recorded. The work is one fullscreen pass with two texture loads per pixel (four with blending) plus the HDR tail, and 20 kB of index texture: Tier A is expected.

## Pitfalls

- **The art has to be drawn for cycling.** Cycling moves colours along the order of the range, not along the picture. The waterfall here was not drawn with bands across the flow, so as drawn it flickers in large patches; the `by row` lag makes it flow but changes the art's look (diagonal two-row bands). Real colour-cycled scenes are painted with the cycle in mind.
- **One colour, one motion.** The waterfall's foam is `a9bbbf`, the same colour as the lit rock, so the foam cannot cycle without the rock cycling too. An indexed image needs separate entries for colours that look the same but move differently.
- **Rare colours spread.** The lava range includes `da3a37`, which the art uses on one texel; once it cycles, it becomes a full band like the others.
- **Flashing is counted per step, not per cycle.** A single texel passes dark to bright once per cycle, but the flash analyser (`tests/flash.ts`) averages cells of many texels in different bands, and the cell average moves at every step: two steps make one flash. Measured: 6 steps a second peaks at exactly 3 flashes per cell per second; 15 steps a second reaches 7 over about 222 000 px² (`high`). The speed is therefore capped at 5 steps a second (2.5 flashes); the `uncapped (flashes)` preset turns the cap off and is labelled.
- **Blending leaves the palette.** With `blend between steps` on, the in-between colours are not palette colours.
- **255 colours.** The index texture is 8-bit and 255 means transparent, so an image can have at most 255 colours.

## When to use it

Water, lava, waterfalls, glowing runes, neon signs: anything that should shimmer or flow in pixel art at almost no cost, including on phones and as a page header. It needs indexed art drawn for it; for motion the art cannot express as rotating bands (ripples that change shape, splashes), use a flipbook (story 3.2) or a shader effect instead.

## References

- Joseph Huckaby, _Old School Color Cycling with HTML5_ (2010), a canvas player for Mark Ferrari's colour-cycled scenes. Recalled; not re-checked for this write-up.
- W3C, _Understanding Success Criterion 2.3.1: Three Flashes or Below Threshold_: <https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html>
- Björn Ottosson, _A perceptual color space for image processing_ (2020), for the nearest-colour step: <https://bottosson.github.io/posts/oklab/>
