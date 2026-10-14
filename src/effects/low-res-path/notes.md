## How it works

Everything is drawn into a small **virtual image** whose pixels are the art's texels, then scaled up to the canvas. The reusable parts are in `src/gpu/pixel/lowres.ts` and `src/wgsl/lowres-upscale.wgsl`; the effect is a diorama of the sprite batcher on top of them.

1. **Virtual size.** `virtualSize(canvas, targetHeight)` picks the scale (screen pixels per virtual pixel) and the virtual width and height that cover the canvas, plus a margin of two virtual pixels on every side. By default the scale is `canvas height / 180`, whatever fraction that is; with **whole-number scale** it is rounded first, so every virtual pixel is the same number of screen pixels and the height lands near 180 instead of on it.
2. **Pixel camera.** `pixelCamera` frames `height × worldPerPixel` world units at the focus. With one texel per virtual pixel (`worldPerPixel = TEXEL`) a camera-facing sprite at the focus is exactly its own size in virtual pixels. Before building the view it **snaps** the camera: the focus is measured along the camera's right and up vectors in virtual pixels and rounded to whole ones. The camera therefore only ever moves by whole virtual pixels in its own image plane, so the picture shifts by whole pixels and no texel changes shape. The grid is fixed to the world, so `snapToPixels` can put a moving object on the same grid (the walking traveller is snapped this way, sliding along the ground so its feet stay on it).
3. **Draw.** The batcher draws the scene into the virtual image: nearest sampling, a hard alpha cut, no MSAA, unlit, so every virtual pixel is a palette colour.
4. **Upscale.** A fullscreen pass draws the virtual image across the HDR tail's scene target. What snapping threw away, under half a virtual pixel each way, comes back here as an **offset** of the lookup, so the picture glides instead of stepping three or four screen pixels at a time. The filter is **sharp** by default: flat inside a virtual pixel and a one-screen-pixel blend across its edge, the same idea as texel-sampling's sharp mode. That keeps pixels square at a non-integer scale and lets the offset move by fractions of a pixel. **Nearest** and **bilinear** are there for comparison.
5. **Tail.** Output only: no bloom, no tonemapping.

The camera is **orthographic** by default. Only then does snapping hold the whole scene still; with the plan's perspective camera it holds exactly at the focus depth and approximately elsewhere (the **perspective** preset). The inspector switches off the **low-res** path (the same scene at full resolution, with MSAA, alpha-to-coverage and sharp sampling: the HD path), **snapping**, or the **sub-pixel offset**, and its **virtual** view shows the raw virtual image, margin included. The before/after split therefore shows the low-resolution path against the full-resolution one.

### What was measured

`experiments/lowres-path-study.test.ts` pans the camera slowly for 60 frames (walker stopped, the output's dither held still) at 960 × 540 (scale 3) and 1366 × 768 (scale 4.27), and measures:

- **swim**: the share of virtual pixels that differ from the previous frame after the best whole-pixel shift, read through the `virtual` view. Zero means the picture only ever moves by whole pixels.
- **pop**: the temporal second difference of the canvas (as in texel-sampling): high when the picture steps or texels flicker, low when it glides.
- **palette**: the share of drawn canvas pixels within one 8-bit step of a palette colour.

| Orthographic, 960 × 540    | swim  | pop      | palette  |
| -------------------------- | ----- | -------- | -------- |
| **low-res, sharp upscale** | **0** | **1.11** | **0.63** |
| low-res, nearest upscale   | 0     | 4.69     | 1.00     |
| low-res, bilinear upscale  | 0     | 0.57     | 0.14     |
| no sub-pixel offset        | 0     | 5.37     | 1.00     |
| no snapping                | 0.083 | 6.44     | 1.00     |
| full resolution (HD path)  | –     | 1.53     | 0.45     |

At 1366 × 768 (a non-integer scale of 4.27) the default measures swim 0, pop 1.45 and palette 0.72; nearest pops 4.77. With the **perspective** camera the default swims 0.022 (2 % of virtual pixels change shape each frame, against 7.4 % unsnapped) and pops 2.57 at 960 × 540.

Snapping and the offset do different jobs, and both are needed. Snapping alone stops texels changing shape (swim 8.3 % → 0) but leaves the picture stepping by whole virtual pixels (pop 5.4). The offset turns those steps back into a glide (pop 1.1, smoother than the full-resolution path's 1.5). Nearest upscaling keeps every pixel a palette colour but can only move the offset in whole screen pixels, so it judders (pop 4.7). Sharp upscaling glides at the price of a blended pixel at each moving virtual-pixel edge: 63 to 72 % of pixels are exact palette colours, which is the `paletteAdherence` in the scorecard. For an exact palette, use whole-number scale and nearest upscaling and accept the judder, or stop the camera.

## Cost

The scene is drawn at the virtual size (324 × 184 at the defaults) without MSAA, then one fullscreen pass with one texture sample per pixel scales it up. The full-resolution path it replaces draws at the canvas size with 4× MSAA. A study run on Dawn on an Apple M1 Max put every configuration well under a millisecond per frame at 1080p, but the GPU was shared with other work during the run and the marginal costs scattered (some came out negative), so no number is recorded in the scorecard. Not measured in a browser. Memory: one `rgba16float` virtual image and its depth buffer, under 1 MB at the defaults.

## Pitfalls

- **Rotation cannot be snapped.** Orbiting turns the texel grid relative to the pixel grid, so every frame of an orbit re-rasterises the ground and texels swim; only translation is clean. Snapping the yaw to discrete steps was not tried.
- **Perspective can only be snapped at one depth.** Content in front of or behind the focus moves at a different rate on screen (parallax), so whole-pixel steps of the camera are not whole pixels there. Orthographic is the default for that reason; under perspective about 2 % of virtual pixels still change shape each frame.
- **The pitch squashes the art.** Ground texels are foreshortened by sin 35° to 0.57 of a virtual pixel, so with one texel per pixel whole rows of the ground are dropped. The **two pixels per texel** preset (a 360-line virtual image) brings them back at 1.15 pixels a row. Upright sprites would be squashed by cos 35° and lose rows the same way (the 68-texel traveller would be 56 pixels tall); here sprites face the camera fully, which keeps them one texel per pixel. Stretching upright sprites by 1 / cos(pitch) is the alternative, not tried.
- **Moving objects need snapping too**, or they slide across the grid and swim. `snapToPixels` does it for things standing on the ground; it is exact for an orthographic camera and at the focus depth in perspective.
- **The offset needs the margin.** Without the two extra virtual pixels on each side, the shifted lookup would read past the edge of the virtual image.
- **Integer scaling changes the framing** with the canvas size, because the virtual height follows the rounded scale.
- **Device loss, reduced motion and a light page** were not checked for this effect beyond what the host does.

## When to use it

As the second render path of plan.md: everything quantised to one pixel grid, chunky and stable, and cheaper than the full-resolution path because the scene is drawn at a few per cent of the pixels. Tier B, provisionally. Use the orthographic camera and avoid orbiting if the art must hold perfectly still; use the full-resolution (HD) path when the scene needs per-pixel lighting, depth of field or smooth rotation. Later effects can draw into `createLowResPath(...).pass()` and keep the rest of their pipeline unchanged.

## References

Written from memory and not re-checked while writing (no network).

- t3ssel8r's devlog videos on YouTube on pixel-art rendering of 3D scenes describe the same pair of tricks: a camera snapped to the pixel grid, and the snapped-off remainder put back as an offset when upscaling. The specific video was not re-checked.
- The sharp upscale is the same idea as texel-sampling's sharp mode and the libretro project's `sharp-bilinear` shaders: <https://github.com/libretro/glsl-shaders>.
- texel-sampling's notes (in this gallery) for the measurement method behind `pop`.
