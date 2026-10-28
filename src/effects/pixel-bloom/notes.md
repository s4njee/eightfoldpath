## How it works

The genre's lamps, windows and spell sparks are a few texels of art far brighter than anything around them, and they should glow while the cobbles beside them stay crisp. This effect is story 5.4: Fire Temple's HDR tail (the bloom chain of `@mk7s/hologpu-temple-core`, tuned in Fire Temple's `bloom-tuning`) retuned for pixel art, on the village at dusk with its two lanterns lit (`"glow": { "lantern": 5 }` in `assets/scenes/village.json`).

The bloom is `src/gpu/post-fx/pixel-bloom.ts` (`createPixelBloom`, `PIXEL_BLOOM`). It changes one thing about the stock chain and retunes the rest:

- **Threshold each texel, then average.** The stock chain's first downsample takes five overlapping 4-tap boxes of the scene and applies the soft knee to each box's mean. A lamp's glass is a handful of texels; averaged with the dark frame of the lamp before the threshold sees it, most of its excess is gone. `source: 'texel'` runs `pixel-bloom.wgsl` first: every scene texel through the knee on its own, then 2 × 2 of them averaged into a half-size image, which a full-resolution chain takes with its own threshold off. The level sizes are the stock chain's; the only new work is that one quarter-size pass. `source: 'average'` is the stock chain, kept for comparison.
- **Threshold above the lit scene.** 2, with a narrow knee of 0.25 (so nothing under 1.75 contributes). The stock tail's 1 with a knee of 0.5 lets everything over 0.5 feed the bloom.
- **A tight glow.** Radius 0.45 and one level fewer than automatic (`levels: -1`; 4 at 1080p, 3 at 540p), so the reach stays a fixed share of the picture at every size, as Fire Temple's `bloomLevelsForSize` intended.
- **No firefly weighting.** With a per-texel threshold the only texels left are emissive, and weighting them by 1 / (1 + luma) only dims the lamps.

`src/gpu/post-fx/tail.ts` (`createPostFxTail`) is the tail with this bloom in it; it takes the same values as `createHdrTail`, and `PIXEL_TAIL_PARAMS` are `TAIL_PARAMS` with these defaults. The inspector shows the **bloom source** (what the threshold lets through, drawn in place of the scene) and the **bloom alone**; the stages are the bloom, the lanterns' glow and the lamps' light.

**What smears, measured.** `experiments/pixel-bloom-study.test.ts` (results in `experiments/pixel-bloom-results.json`, crops in `output/pixel-bloom-study/`). First the radiance: the village's HDR scene at 960 × 540, read back with the glow on and off, so the 521 texels that change are the glass. At dusk no lit texel is brighter than 1.06 (99.9% are under 0.33); at midday the brightest is 2.02 and 1.9% are over 1, but only 5 texels are over 1.75. The glass is never under 3.5 (median 4.8). So a threshold of 2 sits between the two at both times of day, and 1 does not at midday.

Then each setting on the effect, camera still, compared with the same frame without bloom, in 8-bit steps of the brightest channel: the **glow** is the mean change 1 to 4 px outside the glass, the **reach** how far out the ring mean stays at 2 steps or more, **contrast kept** the texel-to-texel contrast of the art within 24 px of the glass with bloom over without, and **far** the share of pixels more than 64 px from any glass moved by 2 steps or more (nothing there is emissive, so any change is smear).

| Setting (dusk unless stated)                                   | Glow    | Reach     | Contrast kept | Far, dusk / midday |
| -------------------------------------------------------------- | ------- | --------- | ------------- | ------------------ |
| Stock tail: average, threshold 1, radius 0.7, automatic levels | 73      | 33 px     | 0.66          | 0 / 4.8%           |
| The lens effects' tail: average, 1.5, radius 0.55, 0.5         | 54      | 23 px     | 0.77          | 0 / 0              |
| Low threshold to rescue the lamps: average, 0.6, 0.8           | 99      | 38 px     | 0.61          | 3.9% / 23.6%       |
| Average, threshold 2, the pixel settings otherwise             | 64      | 16 px     | 0.81          | 0 / 0              |
| The same at intensity 2.4                                      | 118     | 20 px     | 0.74          | 0 / 0              |
| **Texel, threshold 2, radius 0.45, levels −1 (default)**       | **107** | **18 px** | **0.78**      | **0 / 0**          |
| Texel, threshold 1                                             | 125     | 19 px     | 0.76          | 0 / 4.3%           |
| Texel, threshold 2, automatic levels, radius 0.7               | 96      | 35 px     | 0.64          | 0 / 0              |
| Texel, threshold 2, levels −2                                  | 109     | 11 px     | 0.87          | 0 / 0              |

Three things make bloom smear pixel art, and each has its own fix:

1. **A threshold under the lit art** lifts the whole picture. At midday the stock threshold moves 4.8% of the pixels nowhere near a lamp, and the 0.6 that people reach for to make small lamps glow moves 24%. A threshold of 2 moves none, at dusk or midday.
2. **A wide glow** washes over the art around the lamp. The stock reach (automatic levels, radius 0.7) is 33 px, 6% of the height, and keeps 66% of the contrast of the lamp posts and cobbles; one level fewer at radius 0.45 reaches 18 px and keeps 78%. Two fewer keeps 87%, but reads as a sticker outline around the glass, as Fire Temple found at two levels.
3. **Thresholding after averaging** starves small lights, which is what pushes people to the low threshold in the first place. With the same settings the per-texel source gives 1.7 times the halo of the averaged one (107 steps against 64). Turning the averaged one up to match (intensity 2.4) does get there, but the halo is wider and it keeps less of the contrast (0.74 against 0.78).

The firefly filter costs the halo 6% here (100 against 107), both sources alike.

## Cost

**Study** (`npm run study -- --epic 5`, [docs/studies/epic-5.md](../../../docs/studies/epic-5.md), Apple M1 Max on Dawn, marginal cost per frame with the tail, at the defaults): **1.1 ms at 1920 × 1080 and 0.31 ms at 1266 × 585**. Loads this light sit near Apple Silicon's timing floor, so differences under about half a millisecond are noise; nothing has been measured on an integrated GPU or a phone, where the tier budgets are set.

Counted at 1920 × 1080 (`bloomWorkload` in temple-core): the stock half-resolution chain at its automatic 5 levels is 9 passes, 1.38 M texels written and 15.2 M taps, in 5.5 MB of levels. Pixel bloom is the quarter-size source pass (518 400 texels, 4 loads each) and a 4-level chain over it (7 passes, 1.37 M texels, 15.1 M taps): 8 passes, 1.89 M texels and 17.2 M taps, in 9.6 MB (the levels and the half-size source). So about 14% more texture reads and one fewer pass.

GPU time, taken on a busy GPU (an Apple M1 Max shared with other work, Dawn under Node, `experiments/post-fx-cost.test.ts`, slope of repeated frames): the whole effect at 1080p, scene included, read 0.57 to 0.96 ms at the defaults, 0.57 to 0.81 ms with the stock tail's bloom and 0.35 ms with no bloom. The two blooms are inside each other's run-to-run spread; `npm run study` has not been run for this effect, and no integrated GPU or phone has been measured.

## Pitfalls

- **The knee starts below the threshold.** A threshold of 2 with the stock knee of 0.5 lets 1.5 through, which is close to the brightest lit texel at midday (2.02). Keep the knee narrow, or the threshold higher, for bright scenes.
- **The threshold is in scene units, before exposure.** A scene lit brighter, or lamps made dimmer (`glow`), needs it moved; the bloom source view shows what passes.
- **The per-texel source blurs once more.** The chain's own first pass is a 13-tap filter over the half-size image, so the finest glow is about one half-resolution texel wider than the stock chain's.
- **Measured on one scene at one size.** The radiance figures are the village's; a scene with brighter art (snow at noon, white walls under a strong sun) needs its own look at the bloom source view. The study ran at 960 × 540 only.
- **Fireflies under motion.** Without the firefly weighting a single hot texel crossing pixel boundaries could flicker as the camera moves. The lamps are several texels and the flash analyser finds nothing, but it has not been checked through the loupe.

## When to use it

For every diorama scene and hero with emissive art: it is the bloom the lens effects should end with, at Tier B alongside the scene (the bloom itself is Tier A work). Use the stock tail for effects whose glowing parts are large and soft (fire, spells over the page), where averaging first costs nothing and the firefly filter matters. If a scene has bright lit art and lamps of the same brightness, no threshold separates them; give the emissive art more glow in the scene instead.

## References

- Jorge Jimenez, [Next Generation Post Processing in Call of Duty: Advanced Warfare](https://www.iryoku.com/next-generation-post-processing-in-call-of-duty-advanced-warfare) (SIGGRAPH 2014): the downsample and upsample chain this bloom keeps.
- Brian Karis, [Real Shading in Unreal Engine 4](https://blog.selfshadow.com/publications/s2013-shading-course/) (SIGGRAPH 2013 course): the firefly weighting turned off here.
- Unity, [Bloom (Post-processing stack v2)](https://docs.unity3d.com/Packages/com.unity.postprocessing@3.4/manual/Bloom.html): the soft knee.
- Fire Temple, `src/effects/bloom-tuning/notes.md`: the reach per level and the automatic level count.
