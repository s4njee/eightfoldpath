## How it works

Outlines are found after the scene is drawn, from a small G-buffer, and blended over it in one fullscreen pass. Four passes a frame:

1. **Colour.** Terrain blocks (`blocks.wgsl`, a small instanced box pipeline in this effect, because the sprite batcher has no fixed walls) and every sprite through the batcher, unlit, with a hard cut-out at sample count 1.
2. **G-buffer.** The same blocks and the same batch drawn again into an `rgba16float` target with its own `depth32float`. The batcher has one colour target, so this is a second draw rather than a second render target; a group 2 uniform switches its shade chunk (`outlineSpriteShade()` in `src/gpu/lighting/outline.ts`, `src/wgsl/outline-sprite.wgsl`) from art to `(n·right, n·up, id)`: the view-space normal's x and y (z is implied, since every visible surface faces the camera) and an object ID. The sky is 0, all terrain shares ID 1 so tile seams never draw, and sprite `i` is `i + 2`.
3. **Selection mask.** The selected sprite alone, depth only, through a second one-sprite batch (`drawDepth`), from the same camera.
4. **Outlines** (`src/gpu/lighting/outline.wgsl`). Every input is read with `textureLoad`: no sampler, so nothing blurs and the depth texture needs no filtering (`docs/support-matrix.md` §5).

The rule that keeps lines one pixel wide: pixel p gets a line when it differs from one of its four neighbours q **and p is the nearer of the two**. Testing each pair from both sides and keeping one puts the line on the foreground object, the way a pixel artist draws an outline, instead of a two-pixel line straddling the edge. The three tests:

- **Depth.** 1/z is linear across a plane in screen space, so a floor at a grazing angle changes depth a lot per pixel yet continues exactly through the pixel behind p. A step is a depth edge only when neither "same depth" nor "same slope" explains it by more than the threshold (2% of the distance by default). This is what finds a raised terrace's back rim against the floor beyond it: same object, same up-facing normal.
- **Normal.** The angle between the two normals is over the crease angle (40°). Across a silhouette the line follows the nearer side. Across a crease, where depth is continuous, "nearer" flips from pixel to pixel along the fold (both sides recede from it) and the line came out dotted, so there it goes on the side that faces the camera less, which is the same side all along. This is what finds a block's top-to-front edge.
- **Object ID.** The IDs differ. This is the only thing that separates the slime from the chest it sits a twentieth of a tile in front of, facing the same way.

**Selection.** Hovering picks on the CPU (`src/gpu/lighting/outline-pick.ts`): a ray through the pointer meets each upright sprite's quad, the hit counts only where the art's alpha is solid at that texel, the front-most hit wins, and terrain boxes can hide sprites. No ID read-back, so no GPU round trip. With no pointer over the canvas (and in posters and tests) the selection steps through the three characters every 2.5 seconds. The post pass draws the selection colour on pixels just outside the mask that touch it, so the outline never covers the art, and dims it to 40% where the mask is farther than the scene there: the outline of the mage shows through the boulder in front of her (an x-ray selection).

The inspector has `depth`, `normals`, `ids` and `edges` views (edges coloured red for depth, green for normal, blue for ID, mixed where several agree) and switches each source and the selection off. In this scene each source has pixels no other source finds, which `tests/inspect.test.ts` checks at 48 × 32.

## Cost

GPU time: not measured yet. The extra work over a plain sprite scene is a second draw of every block and sprite, a one-sprite depth draw, and one fullscreen pass that makes ten texture loads a pixel for the edges (five surfaces of G-buffer plus depth) and up to five more for the selection.

Memory, by arithmetic: at 1920 × 1080 the G-buffer is 16.6 MB (`rgba16float`), its depth 8.3 MB and the selection mask 8.3 MB, 33.2 MB on top of the scene's own colour and depth. The second batch for the selection packs the sprite sheets again (eleven layers of 99 × 99 texels, about 0.4 MB). Bundle size not measured.

## Pitfalls

- **One screen pixel is thin next to pixel art.** At 540 lines a texel is about four pixels, so the art's own outlines are four pixels thick and the post-pass lines are hairlines beside them. They read on terrain creases and steps; around sprites they mostly duplicate what the artist drew. On the low-resolution path (story 3.8), where a pixel is a texel, they would match the art. Thicker lines need a second pass that dilates the edge mask; not built.
- **Two draws instead of MRT.** The batcher's pipeline has one colour target, so the scene goes through the vertex stage twice. A G-buffer target on the batcher itself (MRT; `rgba16float` × 2 is 16 B a sample, inside the 32 B limit) would halve that.
- **The shade chunk owns group 2**, for its mode uniform, so a lit shade chunk (3.3) that brings its own group 2 bindings cannot be combined with it as written.
- **Tint and hit flash leak into the G-buffer**: the batcher multiplies whatever the shade chunk returns by the tint and pushes it toward white by the flash. Sprites drawn into the G-buffer need a white tint and no flash.
- **The batcher's `sprites` buffer is vertex-only**, so the shade chunk cannot look up a sprite's facing; it recovers it from the fragment normal instead (ground is exactly up, upright is horizontal). The fragment normal of upright sprites points away from the camera in `batch.wgsl`, so the chunk rebuilds it.
- **Hard cut-out only.** With alpha-to-coverage the colour edge is antialiased but the G-buffer edge is not, and the line sits half a pixel off the art. The effect draws at sample count 1 with a 0.5 cut so colour, G-buffer and mask agree on every pixel.
- **Depth precision.** `depth32float` with a 0.1 near plane leaves the linearised depth good to about 10⁻⁵ of the distance at 20 units, far below the 2% threshold. A much nearer near plane or `depth24plus` would need the threshold re-checked.
- **Picking ignores the ground** and only knows boxes as occluders; a sprite behind a sloped or non-box mesh would still be picked.
- **Pixel stability** under the camera sway (`sway` param, off by default) was not checked with the loupe; the lines follow the cut-out edges, so they crawl exactly as much as those do.

## When to use it

Tier B, provisionally: four passes, two of them full-scene. The **selection outline** is the most useful piece for this style: a hover or selection highlight that reads over busy pixel art and shows through occluders, at the cost of one tiny depth draw. Of the three line sources, **normal edges** do the most for a diorama (they draw the creases of blocks and cliffs, which the art cannot), then **depth** (steps between terrain levels). **ID edges** mostly repeat the outlines already drawn into sprite art; keep them for overlapping props at similar depth, or for art without outlines. Recommended defaults: all three on, depth threshold 0.02, crease angle 40°, dark ink at 0.9 opacity; the `silhouettes` preset (depth only) is the cheapest look that still separates terrain levels. Where the art already has outlines and the terrain is flat, skip the line pass and keep only the selection.

## References

- Takafumi Saito and Tokiichiro Takahashi, "Comprehensible rendering of 3-D shapes", SIGGRAPH 1990: the G-buffer, and lines found from depth and normal discontinuities in it. <https://doi.org/10.1145/97880.97901>
- WGSL `textureLoad`, including on `texture_depth_2d`: <https://gpuweb.github.io/gpuweb/wgsl/#textureload>
- This repository's `docs/support-matrix.md`, §2 (no depth resolve; 32 bytes of colour attachments per sample) and §5 (reading depth with `textureLoad`).
