## How it works

The same diorama is drawn three times side by side, one column per way of reading the pixel art, while the camera pans slowly (or orbits). Left to right: **nearest**, **bilinear** and **sharp**, the three modes of `src/wgsl/sampling.wgsl` that the sprite batcher (`src/gpu/sprites/batch.ts`) already offers. Each column is a viewport of one render pass with its own camera aspect and its own batcher view, so all three see exactly the same scene at the same instant. The ground is a checkerboard of cobbles and grass running away from the camera, so one frame holds art magnified several times (the front row) and art squeezed below one texel per pixel (the far rows). Nothing animates; every change between frames comes from the camera.

- **Nearest** reads one texel, exactly. Crisp, but as the camera moves, which texel a pixel lands on flips from frame to frame, so texels grow and shrink by a pixel and edges crawl.
- **Bilinear** is the hardware filter. Smooth under motion, but every texel edge is spread over a whole texel, so magnified pixel art goes soft.
- **Sharp** pins the lookup to the texel centre except within half a screen pixel of a texel edge, where it ramps across the edge so the hardware filter makes a one-pixel blend. The width of that half pixel comes from `fwidth(texel)`. Flat texels, antialiased edges, one sample.

**Mipmaps** (a parameter) switch the colour to a mipmapped copy of the batcher's texture array, built by `packMippedTextureArray` (`src/gpu/pixel/mips.ts`) and read by `src/wgsl/texel-mips.wgsl`, which has the same three modes over a mip chain: nearest texel of the nearest level, trilinear, and sharp sampling done on the two levels either side and blended. The level is `log2` of the larger component of `fwidth(texel)` plus a bias. The copy comes in through the batcher's pluggable `sprite_shade` chunk (`shade.wgsl`), with its own bindings in group 2; the batcher itself uploads level 0 only.

The inspector's **footprint** view colours each fragment by texels per pixel (blue magnified, white one to one, red minified) and **mip level** shows the level texel-mips would read. Red is where nearest sampling skips texels and mipmaps start to matter.

### What was measured, and the default it sets

`experiments/texel-sampling-study.test.ts` renders the scene headlessly on Dawn (Apple M-series, Metal) for 40 frames of a slow pan, once per mode, with and without mipmaps, in a 320 × 180 CSS box at device pixel ratios 1, 1.5, 2 and 3 (canvases of 320 × 180 up to 960 × 540; the scene is framed by height, so a ratio here is simply more pixels per texel). Each frame is compared with a reference: the same frame drawn with nearest sampling at four times the size and box-filtered down in linear light, 16 samples per pixel. The output pass's per-frame dither is held still (frame 0) so it is not counted as motion. Three numbers, all on luma in 8-bit steps (`experiments/texel-metrics.ts`):

- **error**: mean absolute difference from the reference. Lower is more faithful.
- **pop**: mean |f(t+1) − 2f(t) + f(t−1)|, the temporal second difference. Under slow, steady motion a well filtered pixel changes at a steady rate; a pixel that holds and then jumps is shimmer. Lower is calmer.
- **edge contrast**: mean neighbour difference relative to the reference's. Under 1 is blurrier, over 1 is harsher (aliasing or stair-steps).

Default scene (pitch 35°, nine world units framed, pan), no mipmaps; edge contrast in the bottom 40 % of the frame, where the art is magnified:

| DPR | error n / b / **s**    | pop n / b / **s**      | edge contrast n / b / **s** |
| --- | ---------------------- | ---------------------- | --------------------------- |
| 1   | 10.2 / 3.85 / **3.29** | 3.67 / 0.79 / **0.97** | 1.35 / 0.96 / **0.92**      |
| 1.5 | 7.46 / 3.99 / **2.41** | 3.67 / 0.79 / **0.92** | 1.17 / 0.85 / **0.95**      |
| 2   | 5.88 / 4.66 / **1.94** | 3.66 / 0.78 / **0.99** | 1.12 / 0.82 / **0.98**      |
| 3   | 4.15 / 5.84 / **1.46** | 3.66 / 0.78 / **1.20** | 1.10 / 0.80 / **1.01**      |

Sharp is the most faithful at every ratio, and its edges stay within a few per cent of the reference's contrast. Nearest pops about 3.7 at every ratio, three to four times sharp, because a texel boundary crossing a pixel is an abrupt flip however many pixels there are. Bilinear is the calmest, but its error grows with the ratio (3.85 to 5.84) and its edge contrast falls to 0.80: the more the art is magnified, the more visible the blur. The orbit pass gives the same order (at DPR 1: pop 4.77 / 0.90 / 1.27; error 10.2 / 3.84 / 3.32).

Minified art is where mipmaps earn their place. The "far ground" pan (pitch 20°, 16 units framed) puts most of the ground below one texel per pixel at DPR 1:

| far ground, DPR 1            | error    | pop      | edge contrast (far) |
| ---------------------------- | -------- | -------- | ------------------- |
| nearest                      | 8.16     | 1.79     | 2.03                |
| bilinear                     | 4.90     | 0.41     | 1.65                |
| sharp                        | 3.96     | 0.73     | 1.48                |
| sharp + mipmaps, bias 0      | 4.36     | 0.26     | 0.69                |
| **sharp + mipmaps, bias −1** | **3.19** | **0.41** | **0.93**            |

Without mipmaps every mode aliases there (contrast 1.5 to 2). Unbiased mipmaps overshoot into blur (0.69), because the level is chosen isotropically and from `fwidth`, which overestimates the footprint (see Pitfalls). A bias of −1 level lands closest: 19 % less error and 44 % less popping than sharp alone, at nearly the reference's contrast. At DPR 3 the same comparison is 1.83 / 0.46 / 1.15 without mipmaps and 1.78 / 0.41 / 0.91 with them. In the default scene, where little is minified, biased mipmaps change nothing measurable (error 3.25 against 3.29 at DPR 1, 1.45 against 1.46 at DPR 3).

**The default for every later effect: sharp sampling, no mipmaps.** Where a scene shows a lot of red in the footprint view (long views over the ground, small canvases at DPR 1), add mipmaps with a −1 bias. This is what `texel-sampling`'s defaults are (mipmaps off, bias −1 ready for when they are switched on).

## Cost

One render pass of three viewports (eight sprites and thirty ground tiles each) plus the HDR tail's output pass; bloom is off. GPU time was measured with the study harness on Dawn on the development machine (an Apple Silicon laptop) while other work was running on it, so read it as indicative only: see the Scorecard tab once `npm run study` has been run on a quiet machine. Not measured in a browser yet.

Memory: the batcher's texture array is ten layers of 99 × 99 texels, about 390 kB. Mipmaps add a second, mipmapped copy of it, about 520 kB, because the shared batcher has no mip levels of its own. Sharp sampling with mipmaps reads two levels, so two samples instead of one.

## Pitfalls

- **`fwidth` is not the footprint.** It is |dx| + |dy| per component, so where the texel grid is turned on screen it overestimates by up to √2. Sharp sampling then blends across up to 1.4 pixels instead of one, and the mip level is chosen up to half a level coarse. The −1 bias compensates for the second; a length-based footprint (`max(length(dpdx), length(dpdy))`) would fix both, but the batcher computes `fwidth` before calling the shade chunk.
- **Mipmaps darken edges unless colour is bled first.** The cleaned art stores transparent texels as (0, 0, 0, 0), and a linear downsample averages that black into every edge. `bleedColour` copies neighbouring colour into transparent texels (and the padding around small sprites in a shared layer) before the chain is built.
- **Cut-out edges are not mipmapped here.** The batcher runs its alpha test on its own level-0 sample before the shade chunk runs, so with mipmaps on, only the colour comes from the chain. Distant silhouettes still alias. Fixing that needs mip levels in the batcher itself.
- **Mip levels are isotropic.** A floor seen at a grazing angle is blurred along its short axis to stop aliasing along its long one, which is most of the blur measured with an unbiased level. Anisotropic filtering (`maxAnisotropy` with `textureSampleGrad`) was not tried.
- **Sharp pops a little more than bilinear**, and more at higher ratios (1.20 at DPR 3), because an edge one pixel wide that moves is a pixel changing over a few frames and then stopping. The supersampled reference does the same; bilinear is calmer only because it is blurrier.
- **The reference is not perfect.** Sixteen samples per pixel still steps in sixteenths as an edge crosses, so the reference itself pops (1.4 to 2.3); the pop numbers are for comparing modes, not distances from an ideal.
- **Device pixel ratio was emulated** as canvas size in a fixed CSS box. Nothing was checked on real 1.5× or 3× screens, and nothing in a browser.
- **The nearest column shimmers on purpose**, which is why the scorecard says so; the sharp column is the one that holds still.

## When to use it

As a reference, not on a page: it exists to settle how the rest of the gallery samples pixel art and to show why. Tier B because it draws the scene three times. Later effects should call `sample_pixel_art` with `'sharp'` (the batcher's `sampling: 'sharp'`), and reach for `packMippedTextureArray` and `texel-mips.wgsl` only when the footprint view says the art is minified.

## References

Links were written from memory and not re-checked while writing (no network); treat the exact paths as unverified.

- The "sharp bilinear" idea: scale with integer nearest-neighbour inside a pixel and filter only across its edge, as in the libretro project's `sharp-bilinear` shaders: <https://github.com/libretro/glsl-shaders> (under `interpolation/`).
- Inigo Quilez, "Improved texture interpolation", reshaping the fractional texel position before the hardware filter, the same trick sharp sampling uses: <https://iquilezles.org/articles/texture/>.
- WGSL: `fwidth`, `textureSampleLevel` and the derivative uniformity rules: <https://www.w3.org/TR/WGSL/>.
- WebGPU has no built-in mipmap generation; `src/gpu/mipmap.ts` (from temple-core) fills levels by downsampling: <https://www.w3.org/TR/webgpu/>.
- Bleeding colour into transparent texels before mipmapping is common practice (often called alpha bleeding or edge padding); no single source is relied on here.
