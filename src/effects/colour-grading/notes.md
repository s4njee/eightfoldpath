## How it works

HD-2D scenes change colour with the place and the hour: warm lamplight in a town square, cool green on a forest road, amber and violet at dusk, a blue night. This effect is story 5.7: a look per time of day and one per area of the village, baked into 3D lookup tables and crossfaded whenever either changes.

**Looks, not files.** A look (`GradeLook` in `src/gpu/post-fx/grade.ts`) is a handful of parameters: exposure, white balance (temperature and tint), contrast about a pivot, a black lift (fade), saturation, and split toning (shadows and highlights pushed toward a colour). Everything after the white balance happens in OKLab (Ottosson 2020), so contrast and saturation move lightness and chroma without shifting hue, and the split tones are offsets in its a/b plane. The village's looks are `src/effects/colour-grading/looks.ts`: three times of day and three areas, applied in that order (the area on top of the time). No lookup table files are shipped, so `assets/manifest.json` has nothing new.

**Tables.** `buildGradeLut` evaluates a chain of looks at every cell of a 32 × 32 × 32 grid on the CPU, and `createGradeLuts` keeps two `rgba16float` 3D textures: the look on screen and the one being faded to. Asking for a new look (`show(key, looks, seconds)`) builds its table (once; they are cached by key), writes it into the spare texture and starts the fade; asking for the one already shown does nothing, so the effect calls it every frame. A new look in the middle of a fade first bakes the blend that is on screen into the outgoing texture, so a camera that turns back half-way never jumps. The finishing pass (`src/gpu/post-fx/finishing.wgsl`) reads one table, or both while a fade runs, with trilinear filtering.

**Area and time.** The camera tours the square, the road on to the north, and the shore, holding at each. The area is the one under the camera's focus point (`areaAt`), held until the focus is three quarters of a unit into the next one, so a camera resting on a border does not flicker between looks. The time of day is chosen or cycled; it also moves the sun and the exposure, eased over the same fade as the grade. The inspector shows the **grade table** (its 32 blue slices side by side, red across and green down) and switches off the time-of-day grade, the area grade, or the time-of-day light; it cuts rather than fades so a switch shows at once.

**Where it sits: after the tonemap.** plan.md's order is scene, fog and shafts, depth of field, bloom, grade and tonemap, finishing, sRGB. The grade goes after the tonemap, on display-referred colour, sRGB-encoded, in 0..1, for three reasons. That domain is bounded, so a fixed grid covers all of it. Its steps are close to even perceptually, so 32 of them are enough: for the nine village chains and 20 000 colours spread through the cube per chain, a 32³ table is within a median of 0.04 8-bit steps of the exact look and only 4.4% of colours are more than a step out (`tests/post-fx.test.ts` checks a smaller sample of the same). The same 32 cells spaced over linear light leave 25% of colours more than a step out, most in the darks (p99 11.8 steps against 2.7); 17³ on encoded colour leaves 13%, 64³ 0.9%. And it is where a look painted over a screenshot belongs, so an artist's table would drop in. The bloom is in the picture by then, so a dusk grade warms the lamps' glow along with the lamps. A table on scene-linear radiance, before the tonemap, would need a shaper curve and a ceiling, and the tonemap would then have to be inside the table too.

The pass is the same one that does story 5.8's finishing (`src/effects/finishing`): `createPostFxTail` runs the temple-core output pass into a display target with its dither off, then this pass into the canvas.

## Cost

**Study** (`npm run study -- --epic 5`, [docs/studies/epic-5.md](../../../docs/studies/epic-5.md), Apple M1 Max on Dawn, marginal cost per frame with the tail, at the defaults): **0.59 ms at 1920 × 1080 and 0.35 ms at 1266 × 585**. Loads this light sit near Apple Silicon's timing floor, so differences under about half a millisecond are noise; nothing has been measured on an integrated GPU or a phone, where the tier budgets are set.

Per pixel: one 3D texture read, two during a fade, in a pass that also does the finishing. Counted, the grade and finishing pass adds one full-resolution pass (2.07 M pixels at 1080p) and one `rgba16float` display target (16.6 MB at 1080p), which the stock tail does not need; folding the pass into the output pass upstream would remove both. The two tables are 256 kB each on the GPU; each cached table is 512 kB of CPU memory (nine keys here, 4.5 MB if all are visited).

Building a table takes 6.7 ms on the CPU for a two-look chain (Apple M1 Max, Node; it was 35 ms before the look maths was made allocation-free and the transfer curves tabulated), the first time each key is shown. On a slow phone that is a dropped frame at the first entry into each area.

GPU time, taken on a busy GPU (M1 Max shared with other work, Dawn, `experiments/post-fx-cost.test.ts`): the whole effect at 1080p, scene included, read 0.59 to 0.66 ms graded against 0.61 to 0.94 ms at grade strength 0, inside each other's run-to-run spread. `npm run study` has not been run for it, and no integrated GPU or phone has been measured.

## Pitfalls

- **Saturated colours crease where a channel clips.** A look that pushes a colour out of gamut is clipped per channel, and the table interpolates across the clip: the worst of the 180 000 colours sampled is 15 steps out. Giving up chroma at constant lightness instead was tried; it made bright yellows (the lamps' glass) wash out to white, which is worse. Strong looks on saturated art want a bigger table or gentler saturation.
- **The tonemap is `none` here**, like the other lens effects, so the art keeps its colours and the lamps clip to white before the grade sees them. A grade cannot bring back what the tonemap clipped; with ACES the highlights keep a little more colour for it.
- **Premultiplied output** is un-premultiplied for the table and multiplied back, which is right for colour but not for a glow with no coverage over the page; the overlay alpha modes are untested with a grade.
- **On an HDR canvas** anything above SDR white is graded as white and its excess carried through unchanged, so the brightest highlights keep their headroom but not the grade's tint.
- **The first visit to an area builds its table** on the main thread (see Cost). Build the likely ones while idle if that matters.
- **Area boundaries are rectangles on the ground.** The camera's focus point decides; a long lens looking across two areas shows the look of the one it is centred on.
- Crossfading tables is a straight blend of two outputs, not a blend of looks: half-way between two strong looks can be duller than either.

## When to use it

On every diorama scene and hero, at Tier B with the scene it grades (the pass itself is Tier A work: one fullscreen pass and a texture read). It is how the time of day reads without relighting, and how one village can hold several moods. For a single fixed look, one table and no crossfade costs the same pass; for none at all, leave `grade` out and the tail skips the pass.

## References

- Björn Ottosson, [A perceptual color space for image processing](https://bottosson.github.io/posts/oklab/) (2020): OKLab.
- Jeff Selan, [Using Lookup Tables to Accelerate Color Transformations](https://developer.nvidia.com/gpugems/gpugems2/part-iii-high-quality-rendering/chapter-24-using-lookup-tables-accelerate-color) (GPU Gems 2, ch. 24): 3D tables on the GPU and their cell-centre offset.
- Unity, [Color Grading (Post-processing stack v2)](https://docs.unity3d.com/Packages/com.unity.postprocessing@3.4/manual/Color-Grading.html): LDR and HDR grading, and where each sits against the tonemap.
- American Society of Cinematographers, [ASC CDL](https://en.wikipedia.org/wiki/ASC_CDL): the slope, offset and power idea behind the exposure, fade and contrast controls.
