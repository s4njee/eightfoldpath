## How it works

The cheapest route to the look: no diorama, no depth buffer, just five flat pixel-art pictures (sky, mountains, hills, a treeline and foreground grass from `assets/parallax`) at different distances, drifting past each other, with the far ones softly out of focus and a low sun throwing light over the ridge. It recreates the side-on backdrops of the genre's title and travel screens, and the multi-layer parallax of 16-bit games with a modern lens on top.

**One number per layer.** Each layer has a parallax p = z_near / z: 1 for the grass, 0 for the sky at infinity (`depth.ts`). A camera moving sideways by d shifts a layer by p·d, and a thin lens focused on a layer with parallax p_f blurs another into a circle of confusion proportional to |p − p_f|, so the same number drives the motion and the blur.

**A 2D offset per layer, not a perspective camera.** A perspective camera looking at planes that face it produces exactly a per-layer scale and offset; with every layer drawn at the same texel density (one of the plan's decisions) the scale is the same for all of them and only the offset is left. So `parallax.wgsl` is one fullscreen pass: each pixel works out its texel in each layer (`pixel / scale + origin`) and composites them front to back, stopping as soon as the pixel is covered. Real geometry would add a vertex stage and five alpha-blended quads, each overdrawing most of the screen. Layers repeat horizontally (the sampler repeats, and offsets are wrapped on the CPU so a long drift keeps its precision); vertically they clamp, so the sky's flat top row extends upward and solid bottoms extend downward. The drift is a function of the clock, so a frame drawn twice at the same time is the same frame; the pointer adds a small eased offset, and page scroll lifts the near layers past the far ones once the header starts leaving the viewport.

**Texel-crisp in focus.** In-focus layers are read with sharp sampling (`src/wgsl/sampling.wgsl`, story 3.1's default) at a fractional scale: flat texels with a one-pixel blend at each edge. The art's transparent texels are given their neighbours' colour first (`bleedColour`), so that blend fades a silhouette out rather than darkening it. The `sampling` control switches to nearest or bilinear for comparison.

**Depth of field, once per layer.** A flat layer facing the camera has the same circle of confusion everywhere, so its blur is not gathered per pixel per frame as a depth-buffer depth of field is (story 5.1). `src/gpu/lens/layer-dof.ts` blurs each layer once, into a texture four times the art's resolution, with a separable Gaussian over premultiplied colour. Because the source is blocks of colour, each source texel is weighted by the Gaussian's integral over its width (an erf difference), so a pass loops over about six sigma of art texels rather than output pixels, and sigma zero gives the blocks back exactly. The blur is redone only when a layer's sigma changes (racking focus, changing the aperture); drawing it is one bilinear sample. Below a quarter texel of blur the sharp and blurred reads are crossfaded, so racking eases in. The default focuses the treeline: the grass in front and the distance behind both go soft, the tilt-shift look; the sun's disc softens with the sky.

**Light shafts.** `src/gpu/lens/shafts-screen.ts` is Mitchell's screen-space radial blur. At a quarter of the canvas size, `fs_mask` draws the sun's light (its disc and glow) wherever the sky is seen and black wherever a layer covers it; two passes of 12 samples then average that mask along each pixel's line toward the sun with exponentially decaying weights. The first pass covers 1/12 of the ray and the second spreads 12 samples of it over the whole ray, so together they take 144 evenly spaced samples (with the right decay at each) for 24 fetches. The result is added to the HDR scene before the tail, so it blooms and tonemaps with everything else. The sun sits just over the ridge; light spills over the peaks toward the viewer, with the peaks' shadows cut out of it.

Then the HDR tail (`src/gpu/post/tail.ts`) with a little bloom, so only the sun glows, and no tonemapping, so the art keeps its palette.

The inspector shows each layer as a flat colour by depth, the circle of confusion (gold in focus, then black to white), the occlusion mask and the shafts alone; its stages switch off depth of field, haze, shafts and bloom.

## Cost

Measured on an Apple M1 Max on Dawn (`npm run study -- --epic 9`, [docs/studies/epic-9.md](../../../docs/studies/epic-9.md)), marginal cost per frame including the HDR tail: **0.6 ms at 1920 × 1080 and 0.6 ms at 1266 × 585** at the defaults, and at most 1.25 ms at 1080p in any preset; the plain preset is 0.63 and 0.26 ms. These loads sit near Apple Silicon's timing floor, so differences under about half a millisecond between presets are noise (the default measures cheaper than presets that do less). It is inside the Tier A budget of 2 ms, but on a faster class of GPU than that budget is set for; integrated GPUs and phones are story 13.2. Its own chunk is 6.0 kB gzipped, 29.9 kB with what it shares.

The shape of the cost:

- **Layers**: one fullscreen pass. A pixel reads one texture per layer until it is covered: two at the bottom of the header, five in the sky. Every texture is a few kilobytes and stays in cache. Sharp sampling is one bilinear fetch and a few ALU operations; a layer crossfading between sharp and blurred reads both.
- **Shafts**: a mask and two radial passes at a sixteenth of the pixels (12 fetches a pixel each), and one full-size additive composite.
- **Depth of field**: nothing per frame. When the focus or aperture changes, two passes per out-of-focus layer (about 0.8 million output pixels for all five, 7 to 9 taps each at the default blur). Racking the focus by hand repeats that each frame of the rack.
- **Memory**: about 0.16 MB of art, 2.5 MB of blurred layers and 1.3 MB of their intermediates, plus three quarter-size shaft targets (3.1 MB at 1080p). The HDR scene and bloom of the tail are most of the 27.8 MB the HUD reported.
- **The plain preset** (no depth of field, sun, shafts, haze or bloom) is the layer pass and the output pass alone.

## Pitfalls

- **The art tiles, nearly.** The sky's first and last columns are identical; the hills differ in one row, the treeline in one, the mountains in four and the foreground in eighteen, but in every case the two edges continue each other and no seam shows when tiled. Checked by rendering each layer twice side by side, magnified.
- **The layers need placing by hand.** Their heights (51 to 76 texels) and empty tops differ, so each has its own height in `LAYERS`. The foreground's bottom two rows are transparent, so it hangs below the view; the sky is shorter than a portrait view, so its flat top row is repeated upward.
- **The sun cannot live in the sky texture.** The sky repeats every 96 texels, and a wide header shows more than that, so a sun drawn into it would appear twice. It is drawn at a fixed screen position instead, which is right for something at infinity: the sky does not move with the camera either (its clouds have their own wind).
- **Shafts need something jagged in front of the light.** A smooth ridge only casts a few broad shadows, so here the shafts read mostly as light spilling over the peaks. Sharper rays need a broken occluder across the sun, such as a treeline at sunset, or a stronger mask; a broad glow in the mask only blurs into a broader glow.
- **Nearest sampling clamps.** `sample_nearest` reads with `textureLoad`, which ignores the sampler's repeat, so texel positions are wrapped into the first copy of each layer before any sampling.
- **Premultiply before blurring.** Transparent texels are stored as black; blurring straight alpha would darken every silhouette. The blur premultiplies, and `tests/parallax-header.test.ts` fills the transparent texels with red to prove none of it reaches the result.
- **One uniform buffer per blur.** Uniforms are written with `queue.writeBuffer`, so five layers sharing one buffer in one submission would all blur with the last layer's sigma.
- **Portrait canvases.** Fitting 64 texels to the height of a portrait phone shows a magnified slice 40 texels wide; the scale is limited so at least the sky's width (96 texels) fits, and the view grows taller instead, with more sky for text to sit on.
- **Measuring shimmer.** The output pass dithers with a pattern that changes every frame, which looks like shimmer to a frame-difference metric; the measurement below holds the dither frame, as story 3.1's study does.

**Pixel stability.** Measured with story 3.1's popping metric (mean temporal second difference of luma) over 40 frames of the default drift at 1280 × 400, 1000 × 337 and 640 × 200 (6.25, 5.27 and 3.13 pixels a texel), in `experiments/parallax-header-stability.test.ts`: 0.09 to 0.12 with sharp sampling against 0.24 to 0.26 with nearest, while sharp sampling changes the picture more smoothly (mean frame difference 0.22 against 0.12, because the edges move every frame instead of jumping). Not yet checked through the loupe in a browser.

## When to use it

A page or section header, a hero backdrop, an empty state: anywhere an ordinary page wants depth and the look without a scene. It is Tier A (provisional until it is measured on an integrated GPU), opaque, and reads the same over light and dark pages. Prefer the plain preset on very weak devices, or racks of focus driven by scroll only if the re-blur cost is acceptable. For a lit scene with real light and shadow, use the hero diorama (story 9.1); for depth of field over a scene with a depth buffer, story 5.1.

## References

- Kenny Mitchell, _Volumetric Light Scattering as a Post-Process_, GPU Gems 3, ch. 13 (2007): <https://developer.nvidia.com/gpugems/gpugems3/part-ii-light-and-shadows/chapter-13-volumetric-light-scattering-post-process>
- Michael Potmesil and Indranil Chakravarty, _A Lens and Aperture Camera Model for Synthetic Image Generation_ (SIGGRAPH 1981), for the thin-lens circle of confusion. Recalled; not re-checked for this write-up.
- Milton Abramowitz and Irene Stegun, _Handbook of Mathematical Functions_ (1964), formula 7.1.26, the erf approximation in `layer-dof.wgsl`.
- Acquire and Square Enix, _The Fusion of Nostalgia and Novelty in the Development of Octopath Traveler_ (Unreal Fest Europe 2019). Recalled; not re-checked for this write-up.
- Sharp sampling: the sources in `src/effects/texel-sampling/notes.md`.
