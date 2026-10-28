## How it works

A painted illustration (`assets/illustrations/town.png`, or the forest or the harbour) covers the canvas, and hovering it steps between full detail and palette-mapped pixel art. It is one fullscreen pass (`pixelate.wgsl`) and the HDR tail, with no low-resolution target.

1. **Blocks in the picture, not on the screen.** Each pixel works out which texel of the picture it shows (the picture covers the canvas about its centre, cropping the longer side) and which block of the picture that texel is in. The grid is anchored at the picture's centre. Every pixel of a block then does the same sums and gets the same colour, so a block is flat without a second pass. Because the grid belongs to the picture, the slight zoom on hover scales the blocks with it instead of sliding the picture under a fixed grid, and the dither pattern, indexed by block, moves with the blocks too.
2. **A block's colour.** One trilinear sample at the block's centre, from the mip level one finer than a texel per block: the bilinear footprint then spans about the block. The full level averages twice its width and washes the colours out before the palette sees them; finer levels alias.
3. **Palette and dither.** The block's colour plus its dither threshold (Bayer by default, or blue noise) goes through story 3.5's 32³ lookup table to the nearest of the 48 palette colours in OKLab. The tail runs with no bloom, no tonemap and no output dither, so the resting pixel art is made of exact palette colours (checked in `tests/pixelate-hover.test.ts`). The default dither strength is 0.06, half of 3.5's 0.12: at four CSS pixels a block the ordered pattern otherwise reads as a woven texture.
4. **Whole steps.** The block size steps through whole CSS pixels (`steps.ts`): `doubling` (the default) goes 1, 2, 4 … up to `pixel size`, and because the grids share one anchor every block of one step is cut exactly into blocks of the step before, so the picture subdivides rather than reshuffling. `linear` goes 1, 2, 3 … like the old console mosaic and reshuffles at every step. Each size becomes whole device pixels (`devicePixels`), and every state gets the same share of the transition (`stateAt`), so the steps keep an even beat.
5. **The hover.** The pointer moves a hover value toward 0 or 1 at a fixed rate (`stepToward`, 0.4 s end to end) rather than exponentially, so it lands; a cubic ease in and out shapes it before it picks a state. A tween driven by elapsed time stands still on a frame with no elapsed time. The block size is computed so that at the pixel-art end a block is exactly its device pixels even when that end is the zoomed one (`blockTexels`): the resting picture is crisp in either direction, and only the moving frames between have blocks a fraction of a pixel uneven.

**Which way round.** Both are offered. `reveal` (the default) rests as pixel art and resolves into the painting on hover; `pixelate` rests as the painting and turns to pixel art. `reveal` reads better on a page of cards: at rest the grid is uniformly in the house style and calm, the hover rewards attention with detail and a slight lean-in, and on a phone a tap reveals. `pixelate` hides the picture just when someone shows interest in it, which suits a playful aside ("the game version") more than content.

Touch has no hover, so a tap toggles the card and a second tap puts it back; a touch that turns into a scroll ends in `pointercancel` and does not toggle. A page can drive the same state from keyboard focus through the `held` parameter. Under reduced motion the gallery draws one frame and the card rests; a site that wants the hover still to work there should set `duration` to 0, which snaps.

The inspector shows the block grid as a checkerboard (which shows where it is anchored), the palette error per block in OKLab, and the dither threshold, and switches off the palette, the dither and the pixelation (palette mapping per device pixel) one at a time.

## Cost

**Study** (`npm run study -- --epic 9`, [docs/studies/epic-9.md](../../../docs/studies/epic-9.md), Apple M1 Max on Dawn, marginal cost per frame with the tail, at the defaults): **0.22 ms at 1920 × 1080 and 0.15 ms at 1266 × 585**. Loads this light sit near Apple Silicon's timing floor, so differences under about half a millisecond are noise; nothing has been measured on an integrated GPU or a phone, where the tier budgets are set.

Not measured on the cost harness: the GPU was shared with other work, so `npm run study` was not run. One reading, taken on a busy GPU and to be read as indicative only: `npm run browser-check` on the Apple M1 Max, 1920 × 1080 with the HUD on, reported a median of 0.48 ms a frame (0.45 to 0.49 over three loads), as the browser measures one frame alone, its timing floor included; the pass itself was about a quarter of a millisecond and the tail's output pass the rest.

Per pixel: one trilinear sample, a `linear_to_srgb`, a threshold (a few bit operations for Bayer, one load for blue noise) and one lookup-table load. Memory: the illustration is 1376 × 768, about 5.6 MB on the GPU with its mips and 1.7 MB to download, so only the one on show is loaded; the table is 128 kB and the blue-noise tile 4 kB. At rest the picture does not change, but the gallery still redraws every frame; a site could stop drawing between hovers.

## Pitfalls

- **The full mip level is too soft.** Sampling at a texel per block averages about twice the block's width; the palette then sees muddy colours and the art loses its lights. One level finer was the fix.
- **Big blocks make the dither a texture.** An ordered pattern at 4 to 8 CSS pixels a cell is plainly visible, which is a look, not a hidden helper. Keep the strength low, use blue noise, or turn it off for large blocks.
- **A screen-anchored grid swims.** Anchoring blocks to the canvas would make every block change colour as the hover zoom moves the picture under it. Anchoring them to the picture's centre keeps them still, and doubling steps nest so the transition subdivides.
- **Fractional blocks during the zoom.** In the frames between the two ends the zoomed blocks are a fraction of a device pixel uneven; it is visible only while moving. A zoom of 0 removes it.
- **Rapid hovering.** Sweeping the pointer back and forth across a card replays the steps; each is a small change in average brightness (the palette keeps the local average), but a site should not tie the hover to anything that flashes.
- **The fallback is the opposite end.** Without WebGPU the fallback image is the painting, so in `reveal` mode a visitor without WebGPU sees the detailed end at rest.

## When to use it

Image cards in a grid (posts, projects, products), a thumbnail that hints at a pixel-art version of the page, or a reveal. One pass over a small canvas, opaque, so it reads over light and dark pages and fits Tier A provisionally at about half a millisecond for a full 1080p canvas in Chrome on the M1 Max. For many cards, one canvas behind the grid drawing each card's rectangle costs less than a WebGPU canvas per card. If the pixel art never changes, map it once offline (as `scripts/clean-art.mjs` does) and cross-fade two images in CSS; the shader earns its place when the step transition, the dither or the picture is live.

## References

- Björn Ottosson, _A perceptual color space for image processing_ (2020): <https://bottosson.github.io/posts/oklab/>
- Bryce E. Bayer, _An optimum method for two-level rendition of continuous-tone pictures_, IEEE International Conference on Communications (1973).
- Robert Ulichney, _The void-and-cluster method for dither array generation_, Proc. SPIE 1913 (1993).
- Martin Korth, _Fullsnes_, register 2106h (`MOSAIC`), the console origin of stepped block sizes: <https://problemkaputt.de/fullsnes.htm>
- Lance Williams, _Pyramidal Parametrics_, SIGGRAPH 1983 (mip-mapping, for the block averages).
