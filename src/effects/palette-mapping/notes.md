## How it works

Palette mapping forces any picture into the project's 48-colour palette (`assets/palette/eightfold.hex`), the way a pixel artist would only ever pick from that palette. The shared code is in `src/gpu/palette/` and `src/wgsl/palette.wgsl`, so the low-resolution path (3.8) and sprite lighting (3.3) can reuse it; this effect is the test scene.

1. **Lookup table.** "Nearest colour" is measured in OKLab, where equal distances look about equally different. Searching 48 colours per pixel costs 48 conversions, so `buildPaletteLut` (`src/gpu/palette/lut.ts`) precomputes the answer for a 32³ grid of colours **on the CPU at start-up** (32 768 cells × 48 colours, a few milliseconds) and uploads it as a 3D `rgba8unorm-srgb` texture: palette colour in RGB, palette index in alpha. The grid is spaced evenly in sRGB-encoded values rather than linear light, which keeps more cells in the darks. The shader rounds its colour to a cell and does one `textureLoad` (`palette_lut_lookup`). Building on the CPU means no compute shader, identical results in the tests, and a direct check against brute force.
2. **Source pass.** The input is drawn into an `rgba16float` target at the pixel-art resolution (canvas size ÷ `pixel size`): a painted illustration, minified through its mips so large blocks do not alias, or a small lit scene of four spheres under a moving light.
3. **Map pass.** At canvas resolution, each block of pixels reads its source texel, adds a dither offset for the block in sRGB-encoded space, and looks up the palette colour. The HDR tail runs with no bloom, no tonemap and **no output dither**, so the canvas receives exact palette colours.
4. **Dither.** Bayer's 8 × 8 ordered matrix is computed from the block coordinates with a few bit operations (`palette_bayer8`). Blue noise is a 64 × 64 tile generated at start-up with Ulichney's void-and-cluster method (`src/gpu/palette/dither.ts`, ported from Fire Temple), since there is no blue-noise asset.
5. **Ramps.** `buildRamp` (`src/gpu/palette/ramps.ts`) derives a dark-to-light ramp of palette colours from one base colour, walking OKLab lightness with the hue turned towards blue in the shadows and yellow in the highlights. With `lit scene shading` set to `palette ramp`, each sphere's light level picks a step of its ramp instead of lighting the colour and searching the palette. Those pixels are already palette colours, so the source pass marks them (alpha 0) and the map pass leaves them undithered.

The inspector shows the mapping error in OKLab as a heat map, the dither threshold, and the table itself (its 32 blue slices side by side). The `lut` stage swaps the table for the exact 48-colour search in the shader (`palette_nearest_exact`), to compare them.

## Cost

Not measured yet. A cost run on an M1 Max (Dawn, 1080p) was taken while other GPU work was running and its per-frame figures were inside the noise (ranges crossing zero), so they are not recorded here or on the Scorecard.

What it costs in memory: the table is 128 kB, the blue-noise tile 4 kB, the palette and ramps under 1 kB. Each illustration is 1376 × 768, about 5.6 MB on the GPU with mips and 1.7 MB to download, so only the one on show is loaded. The source target is `rgba16float` at canvas ÷ pixel size (1.8 MB at 1080p with 3-pixel blocks). Work per pixel is one `linear_to_srgb`, one texture load and a threshold; the exact search (the `lut` stage off) adds 48 OKLab conversions per pixel.

## Pitfalls

- **The table is an approximation.** Over 100 000 random colours it agrees with brute force 93.4% of the time; where it differs, its pick is on average 0.004 and at worst 0.022 further away in OKLab (about one just-noticeable difference), measured by `tests/palette-lut.test.ts`. On the dark town illustration the two differ on 10.9% of pixels (`tests/palette-mapping.test.ts`): the palette is densest in the darks, exactly where 32 sRGB steps are coarsest relative to it. All 48 colours are reachable and each maps to itself.
- **Dither strength is one number for an uneven palette.** The offset is added in sRGB-encoded space; the palette's colours are close together in the darks and far apart in the sky blues and yellows, so a strength that hides bands in the sky adds noise in the shadows. 0.12 is a compromise chosen by eye.
- **Dither helps the average, not the pixel.** Averaged over 8 × 8 squares, the mapped town drifts 0.0138 from the original in OKLab without dither and 0.0119 with either dither; the lit scene's smooth gradients go from 0.0304 to 0.0192 (Bayer) and 0.0193 (blue noise). The two dithers measure the same; they differ in look: Bayer is a deliberate crosshatch, blue noise reads as grain.
- **The dither is anchored to the screen.** It is indexed by block coordinates, so a still picture is stable, but under a moving camera the image would slide under a fixed pattern. A scene that pans needs the threshold in texel or world space, or the snapped camera of the low-resolution path.
- **Ramp-shaded pixels must skip the mapping.** They are already palette colours; dithered again they would sprinkle neighbouring colours over flat ramp steps.
- **The tail's output dither breaks exact colours.** It adds ±1 step of noise per frame; an effect that needs exact palette colours must pass `dither: 0`, not only `tonemap: 'none'`.

## When to use it

As a building block: anywhere lit or painted content has to sit beside pixel art without colours the art never uses. The ramp mode is the better choice for anything lit by the scene's own lights, because it keeps the artist's shading steps; the nearest-colour mode with dither is for content you do not control (a photo, a painted backdrop, a gradient sky). For a fixed picture it is cheaper to map it once offline, as `scripts/clean-art.mjs` does for the test art. Tier C until measured, because the demo runs two fullscreen passes plus the tail.

## References

- Björn Ottosson, _A perceptual color space for image processing_ (2020): <https://bottosson.github.io/posts/oklab/>
- Bryce E. Bayer, _An optimum method for two-level rendition of continuous-tone pictures_, IEEE International Conference on Communications (1973).
- Robert Ulichney, _The void-and-cluster method for dither array generation_, Proc. SPIE 1913 (1993).
- Christoph Peters, _Free blue noise textures_ (2016): <http://momentsingraphics.de/BlueNoise.html>
- Fire Temple's blue-noise generator, `src/gpu/volume/blue-noise.ts` (MIT): <https://github.com/s4njee/firetemple>
