## How it works

The glittering lights of a blurred background: out of focus, a small bright light is an image of the lens's aperture, so a town at night through a fast lens fills with discs, hexagons when the iris has six blades, cat's eyes toward the edges of the frame. A gather depth of field cannot draw that cheaply, since every pixel would have to test the shape against every light that might reach it. This effect leaves the gather for everything dim and draws the bright lights as sprites of the aperture's shape, after Sousa (2013) by way of Moon Temple's sprite bokeh.

The scene is the village at night (`night.ts`): the scene file under a dim blue moon, six more lanterns (eight in all, each a point light, the most a stage takes), and, through the stage's `setSprites`, strings of bulbs between the lanterns and a few fireflies. A bulb is a 2 × 2 patch of a lantern's lit glass on a camera-facing quad a tenth of a unit across, so it glows like the glass does (`"glow"`, six times lit white here). The bulbs matter: a lantern's glass is wider than the blur, so out of focus it draws its own outline convolved with the aperture; a bulb is a point, so it draws the aperture alone.

Then three steps, the last two in `src/gpu/lens/bokeh.ts`:

- **The lens holds the highlights back.** The tilt-shift lens (`src/gpu/lens/tilt-shift.ts`, story 5.1) takes one new optional setting, `bokehThreshold`. Its prefilter averages each 2 × 2 block as before and, for a block blurred by a pixel or more, subtracts the light above the threshold in luminance, keeping the hue: `c (L − T) / L`, so what is left sits exactly on the threshold and nothing pops as a light brightens through it (`bokeh-excess.wgsl`). The gather and the near and far fields then never see that light.
- **Extract** (compute, `bokeh.wgsl`). One invocation per texel of the lens's `prefiltered` target reads the same four sharp pixels and the block's signed circle of confusion from `prefiltered`'s alpha, works out the same excess, and appends one record through an atomic counter: the centroid of the pixels' light above the threshold, the signed radius, and the light. A second one-invocation pass writes the indirect draw's arguments. The share drawn follows the lens's composite, which still shows the sharp image (highlight and all) for circles under 4 pixels, so the discs carry exactly what the composite would otherwise lose: light is conserved, and `tests/bokeh.test.ts` checks it against the lens alone.
- **Draw.** One instanced quad per record, read as an instance vertex buffer, added onto the lens's output. The fragment shader is Moon Temple's aperture (`bokeh-aperture.wgsl`, trimmed): a polygon of `blades` sides rounded toward a circle by `curvature`, a rim (soap-bubble when positive, soft when negative), and a second disc offset away from the frame's centre that clips the shape into a cat's eye. The shape is normalised by its area (`apertureArea`, on the CPU), so a disc's light does not change with its size or shape; below a radius of about three pixels it becomes the exact area of a disc in each pixel. A disc from in front of the focus is flipped, as a real lens flips it. A disc from behind is hidden where the pixel it lands on is clearly nearer than the light: where that pixel's circle in `prefiltered` is under half the disc's, so a sharp character or a blurred foreground covers a lantern behind it while the ground the lantern stands on does not eat its edge.

Why a pass after the lens rather than a stage inside it: the lens's only change is the hold-back, a few lines in its prefilter behind a setting that defaults to off, so the lens and its tests are unchanged without it, the screen method and pages that cannot afford compute keep working, and the bokeh can be reshaped or dropped without touching the gather. `prefiltered` was made for this: it already holds each block's circle where the extract can read it.

The views are the lens's **circle of confusion** and **bokeh alone** (the discs over black). The stages are the shaped bokeh (off: the lens keeps all the light and blurs the lanterns into soft blobs), the depth of field, bloom and the lanterns' glow.

## Cost

**Study** (`npm run study -- --epic 5`, [docs/studies/epic-5.md](../../../docs/studies/epic-5.md), Apple M1 Max on Dawn, marginal cost per frame with the tail, at the defaults): **2.0 ms at 1920 × 1080 and 1.3 ms at 1266 × 585**. Loads this light sit near Apple Silicon's timing floor, so differences under about half a millisecond are noise; nothing has been measured on an integrated GPU or a phone, where the tier budgets are set.

Measured once on an Apple M1 Max on Dawn with other agents using the GPU, so indicative only (the slope method of `tests/bench.ts`, not `npm run study`): at 1920 × 1080 the effect costs about **1.9 ms** a frame (1.7 to 2.1) against 1.4 ms (1.2 to 1.8) with the shaped bokeh off, so the bokeh adds about half a millisecond; at 1266 × 585 the two are the same within the noise (1.0 and 1.2 ms). Nothing has been measured on an integrated GPU, where the B budget is set, or in Chrome. The bundle size has not been measured yet.

What scales it is the number of discs and their area. The night village appends about 2 100 records at 1080p (2 700 focused far, when the shore's lanterns are blurred too), 560 at 960 × 540: one per 2 × 2 block of lit glass, so at 1080p a lantern is a couple of hundred discs and a bulb a handful. Each covers a square of its radius, up to 48 pixels at 1080p, so the overdraw is millions of fragments on a big blur; the extract is one cheap compute invocation per half-resolution texel. Memory: the record buffer, 32 bytes a record, 512 KiB for the default capacity of 16 384, plus 20 bytes of counter and draw arguments; no textures of its own.

## Pitfalls

- **Past the capacity, light is lost.** The lens has already held it back, so a frame with more bright blurred blocks than `capacity` drops the rest (Moon Temple kept them in its remainder for the gather; here the gather has run). Raise the threshold before raising the capacity: a daylit scene with a threshold under lit white would make every sunny surface a disc.
- **The threshold must match.** The lens's `bokehThreshold` and the pass's `threshold` are two settings; a lower one in the pass draws light the lens kept (twice as bright), a higher one loses some. The effect passes the same value to both.
- **Big lights are not discs.** A lantern's glass, wider than the blur, draws its own outline smeared by the aperture. The aperture only shows on lights smaller than the blur, hence the bulbs and fireflies.
- **Occlusion is a guess from one circle per block.** A far disc is hidden where the pixel's circle says it is nearer; a blurred foreground's soft edge, which the near field spreads beyond the foreground's own pixels, does not hide it there, so a lantern can show through the fringe of a blurred near tree.
- **Conservation is per block, with the composite's own blend.** The composite takes its circle per pixel and the prefilter per block (the nearest of four), so at a silhouette a few pixels can gain or lose a little light.
- **Fixed to the screen's 2 × 2 grid.** A light moving by less than a block moves its disc by its centroid, which is smooth, but its share of each block's average changes as it crosses one. Not checked with the loupe under a panning camera.
- Dawn warns about an indirect draw of zero instances when nothing is bright; it is harmless.

## When to use it

Night and dusk dioramas with lanterns, lit windows, torches, fireflies or string lights out of focus, over the depth lens (Tier B, provisional): the half-millisecond it added at 1080p is worth it where the lights are the picture. It needs compute and the depth method, so it has no WebGL2 or screen-lens path; drop it first when the budget is tight, which leaves the lens's soft blobs. By day, with nothing much brighter than lit white, it draws almost nothing and costs almost nothing.

## References

- Tiago Sousa, _CryENGINE 3 Graphics Gems_ (SIGGRAPH 2013 Advances in Real-Time Rendering): bokeh as sprites for the bright pixels and a cheap gather for the rest.
- Moon Temple, `src/gpu/dof/sprites.ts`, `sprites-extract.wgsl` and `src/wgsl/aperture.wgsl`: the port's source for the append, the indirect draw and the aperture's shape and normalisation.
- Jorge Jimenez, _Next Generation Post Processing in Call of Duty: Advanced Warfare_ (SIGGRAPH 2014): the gather this sits on (`tilt-shift`).
- Steiner's formula for the area of a convex shape grown by a margin: the one-pixel edge's correction.
