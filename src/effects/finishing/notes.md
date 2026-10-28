## How it works

The last touches a camera or a print adds: corners a little darker, a grain that moves, colour fringes toward the edges of the frame. This effect is story 5.8, on the village square at dusk with the dusk grade and pixel bloom, and all three are subtle by default.

They are the second half of one fullscreen pass, `src/gpu/post-fx/finishing.wgsl` (`createFinishingPass` in `finishing.ts`), after the grade of story 5.7 (`src/effects/colour-grading`). `createPostFxTail` runs the temple-core output pass (exposure, tonemap, sRGB encode) into an `rgba16float` display target with its dither off, then this pass into the canvas. In order:

1. **Grade**, when a table is given.
2. **Chromatic aberration**: red is read a little further from the centre and blue a little nearer than green, so the fringes run along the radius as a lens's lateral aberration does. The shift grows with the square of the distance from the centre: `aberration` pixels at the corners (1.5 at 1080p by default), a quarter of that half-way out and nothing in the middle, where the subject is. Each shifted tap is graded on its own, so the fringes come after the grade, as plan.md orders it.
3. **Vignette**: the colour decoded to linear light and multiplied by `1 - vignette × smoothstep(radius, radius + softness, r)`, with `r` 0 at the centre and 1 at the corners, measured in pixels so it is round on any aspect. The default darkens the corners by a fifth in linear light, about a tenth as displayed, and starts 45% of the way out.
4. **Grain**: value noise over cells `grainSize` pixels across (1.5 at 1080p), each cell two hashes summed so it is triangular noise in −1..1 with a mean of 0, smoothly interpolated between cells and re-seeded every frame. It is added to the encoded colour, weighted by `4y(1 − y)` of the luminance, so it is strongest in the mid-tones and absent in black and white, as film's is. The default peak is 3 8-bit steps at mid grey.
5. **Dither**: the output pass's triangular dither, moved here because it must come last.

Every part is a uniform branch, so one at 0 costs only the test. The pixel amounts are given at 1080p and scaled with the canvas height, so the look is the same at any size. `FINISH_PARAMS` exposes vignette, grain and aberration with the defaults; this effect adds the vignette's start and softness and the grain's size. The inspector shows each part alone (the vignette's mask, the grain on grey, and the aberration's red and blue difference, eight times over) and switches each off.

## Cost

**Study** (`npm run study -- --epic 5`, [docs/studies/epic-5.md](../../../docs/studies/epic-5.md), Apple M1 Max on Dawn, marginal cost per frame with the tail, at the defaults): **0.87 ms at 1920 × 1080 and 0.35 ms at 1266 × 585**. Loads this light sit near Apple Silicon's timing floor, so differences under about half a millisecond are noise; nothing has been measured on an integrated GPU or a phone, where the tier budgets are set.

One full-resolution pass and its display target (2.07 M pixels and 16.6 MB at 1080p), shared with the grade; neither is needed by the stock tail. Per pixel: one read of the display target and one of the grade table, plus two more of each with aberration on; four integer hashes for the grain; a decode and an encode for the vignette. Folding the pass into the output pass upstream would remove the target and the extra pass.

GPU time, taken on a busy GPU (an Apple M1 Max shared with other work, Dawn under Node, `experiments/post-fx-cost.test.ts`, slope of repeated frames): the whole effect at 1080p, scene and bloom included, read 0.50 to 0.77 ms with everything off and the grade off, 0.66 to 0.77 ms at the defaults without the grade and 0.70 ms with it. The differences are inside the run-to-run spread. `npm run study` has not been run for it, and no integrated GPU or phone has been measured.

## Pitfalls

- **Grain and flashing.** Grain changes every pixel every frame, which is exactly what a flash analyser looks for. It passes (`tests/flash.test.ts`: `none` at the defaults and at every preset, `heavy grain`'s 18 steps included) because the noise has a mean of 0 and averages out over any area larger than a few cells. A grain that did not, a flicker of the whole frame's brightness, would not pass; keep it zero-mean. `tests/post-fx.test.ts` checks the mean at under 0.15 of a step.
- **Grain on pixel art.** Grain finer than a texel sits on top of the art rather than in it, and under reduced motion the shell pauses the clock, which freezes it. Cells of a texel's size read as a texture of the art instead; neither has been looked at through the loupe.
- **Aberration is a blur near the edges.** Shifting red and blue by a pixel or two softens the pixel art's edges there. The default keeps the middle untouched and the corners within a pixel and a half; `old lens` (8 px) shows what more does.
- **The vignette and a light page.** It darkens the corners of the canvas, not the page; over a light page that reads as a grey frame. It is meant for an effect that owns its rectangle.
- **See-through output.** With the overlay alpha modes, the grain and dither are faded out where nothing is drawn and the colour is kept at or below its alpha; the vignette and aberration have not been checked over a page.
- **On an HDR canvas** the dither drops to a 10-bit step, as the output pass's does; the grain does not change.

## When to use it

At the end of the lens on any diorama scene or hero where the canvas owns its box, at Tier B with the scene (the pass is Tier A work). The default is meant to be felt rather than seen; for a page that shows the picture small, the vignette alone does most of the work. Leave it off for an overlay over page content, and turn the grain off for screenshots and posters that will be compressed, where it costs bytes.

## References

- Jorge Jimenez, [Next Generation Post Processing in Call of Duty: Advanced Warfare](https://www.iryoku.com/next-generation-post-processing-in-call-of-duty-advanced-warfare) (SIGGRAPH 2014): interleaved gradient noise, used for the dither.
- Mark Jarzynski and Marc Olano, [Hash Functions for GPU Rendering](https://jcgt.org/published/0009/03/02/) (JCGT 2020): the PCG hashes behind the grain.
- W3C, [WCAG 2.2, success criterion 2.3.1](https://www.w3.org/TR/WCAG22/#three-flashes-or-below-threshold): the flash limit the grain is checked against.
