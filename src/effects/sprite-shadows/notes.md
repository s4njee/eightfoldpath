## How it works

Six sprites stand on a grass-and-cobble diorama under a sun that circles them at a fixed elevation. The `shadow` control switches between four ways of giving a flat sprite a shadow; the ground is the only receiver.

1. **Blob.** A soft disc under each caster's feet, computed in the ground's shader from the casters' positions. No shadow map.
2. **Light-facing billboard** (the default). The cast is drawn into a `depth32float` shadow map from an orthographic sun camera with the batcher's `drawDepth`. Upright sprites turn about the vertical axis toward whatever views them, so seen from the sun they turn toward the sun and cast their whole silhouette, while the camera still sees them facing it.
3. **Crossed quads.** The same shadow pass drawn twice, with the billboards' right vector overridden: once as the camera sees the sprite and once at right angles to that. (Classic crossed quads are fixed to the world axes; tying one quad to the view at least guarantees the visible shape is among them.)
4. **Projected silhouette.** The sprite exactly as the camera sees it, flattened onto the ground along the light with a planar projection matrix (`planarProjection` in `src/gpu/lighting/shadow-map.ts`) and recorded in a map that looks straight down, a hair above the ground.

The ground then reads its map with a comparison sampler (`compare: 'less'`, linear filtering, so each tap is a hardware 2×2 PCF in core WebGPU, docs/support-matrix.md section 5) and a 4×4 kernel spread over one sprite texel, through `shadow_pcf` in `src/wgsl/shadow-pcf.wgsl`. It uses `textureSampleCompareLevel`, since a sprite's shade runs after a discard. The shadow removes the sun and 40% of the sky light. Sprites are lit by the sun through automatic normals (story 3.3) with a half-Lambert wrap, and receive no shadows.

The ground and the cast are two batches with one shade chunk, so only the cast is in the shadow map: the ground never shadows itself (no acne to bias away except where feet meet the ground), and the projected mode does not flatten the ground into its own shadow.

**Which reads correctly from the default camera** (pitch 35°, field of view 25°), judged from stills with the sun behind, beside and in front of the cast:

- **Light-facing billboard reads right at every sun angle.** The shadow keeps the sprite's whole silhouette, points away from the sun and starts at the feet. It never thins out, because the quad always faces the light. Recommended default.
- **Projected silhouette is exact while the sun is roughly behind or in front of the camera**, since then it is the very shape the viewer sees. As the sun moves to the side the quad turns edge-on to the light and the shadow collapses to a line, then vanishes. Right for a fixed camera and a fixed light behind it, wrong for a moving sun.
- **Crossed quads always cast something**, but on diagonals the two silhouettes overlap into a doubled shape (thin parts such as the knight's spear show twice) that reads as noise. It is not better than the light-facing billboard in any case seen.
- **Blob is never wrong and never says where the light is.** It sits half hidden behind the sprite's own feet at this pitch, so it mostly reads as contact. Right for phones and for many small sprites; wrong whenever the scene's light is supposed to be seen.

## Cost

Not measured: the GPU was shared with other work while this was written, so no Dawn or Chrome timing was taken. What it costs: one depth-only pass of the cast (two for crossed quads) into a 1024² `depth32float` map (4 MiB; 16 MiB at 2048²), then 16 comparison taps per ground fragment, each a hardware 2×2 PCF. The blob mode skips the map and loops over the casters (six here) per ground fragment. The scene pass is the batcher at 4× MSAA with alpha-to-coverage.

## Pitfalls

- **A billboard turned toward the light shows its art mirrored in its shadow when the sun is behind it** (the shield changes hands). Silhouettes are mostly symmetric enough that it does not read.
- **The light-facing silhouette is the sprite's width across the light, not across the view.** Its base is the same width as the sprite only when the sun is behind or in front of the camera; side-lit, the shadow's base can look wider or narrower than the feet.
- **Sprites do not receive shadows.** A sprite drawn into the map facing the sun and seen facing the camera is two different quads, so testing one against the other would shadow the sprite with itself (not tried). Sprite-on-sprite shadows need a different approach, such as a per-sprite depth offset or shadowing only below the knees.
- **Feet need a bias.** Where a caster meets the ground the two depths are equal. Three map texels of bias is used; in stills at 960 × 540 the shadows still start at the feet, but contact was not inspected through the loupe.
- **Projected shadows have no depth.** They are only correct on flat ground at one height; on steps or slopes they would need a projection per surface.
- **The shadow can look faint on the cobbles.** The cobble art already has dark mortar lines of about the same contrast as the shadow; on grass it reads at once.
- **The map covers a fixed 20-unit square.** A larger diorama needs the frustum fitted to the view and snapped to texels (story 4.5).

## When to use it

Use the light-facing billboard with a shadow map wherever there is a real directional light and the scene can afford one extra depth pass: Tier B, as a lit diorama piece. Use blobs when it cannot (Tier A, phones, crowds) or when the light is not meant to be read. Projected silhouettes suit a fixed camera with a fixed light behind it, with no shadow map at all if drawn straight into the scene. Crossed quads are not worth it for sprites.

## References

- Lance Williams, _Casting Curved Shadows on Curved Surfaces_ (SIGGRAPH 1978): shadow maps.
- William Reeves, David Salesin and Robert Cook, _Rendering Antialiased Shadows with Depth Maps_ (SIGGRAPH 1987): percentage-closer filtering.
- Jim Blinn, _Me and My (Fake) Shadow_ (IEEE Computer Graphics and Applications, 1988): the planar projected shadow.
- WebGPU comparison samplers and `textureSampleCompareLevel`: <https://gpuweb.github.io/gpuweb/wgsl/#texturesamplecomparelevel>, and this project's `docs/support-matrix.md` section 5.
