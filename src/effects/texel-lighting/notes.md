## How it works

A floating lantern circles a few sprites standing on a cobble tile and a grass tile at night. Its light and its shadow are worked out at the **centre of each texel** instead of at each pixel, so the edges of the light pool and of the shadows follow the pixel art's grid rather than cutting smooth curves through the middle of texels.

The idea is in `src/wgsl/texel-snap.wgsl`. On a flat quad (a sprite or a tile) the world position is an affine function of the texel coordinates. The fragment has the screen-space derivatives of both, so the 2 × 2 Jacobian from screen to texels can be inverted to find the screen step that reaches the texel's centre, and the world derivatives turn that step into a world position:

```
s      = (d texel / d screen)⁻¹ · (floor(texel) + 0.5 − texel)
centre = world + (d world / d screen) · s
```

Every pixel of a texel gets the same `centre`, so every pixel of the texel is lit alike. Once texels are smaller than pixels the move is faded out (`texel_snap_weight`: full up to one texel per pixel, none from two), because one centre per pixel would then be nearest sampling of the light and crawl, as texel-sampling measured for colour.

The effect plugs this into the sprite batcher as a `sprite_shade` chunk (`shade.wgsl`), with its own uniforms and the shadow map in group 2:

1. **Shadow pass.** A perspective shadow camera sits at the lamp, looking at the middle of the scene with a 120° field of view. The batcher's `drawDepth` draws the ground and the cast into a 1024² `depth32float` map; upright cards turn to face that camera, so each casts its silhouette as the lamp sees it. The lantern is a second, colour-only batch, so its own card never sits in front of the camera that looks out from inside it.
2. **Colour pass.** 4× MSAA with alpha-to-coverage and sharp sampling (texel-sampling's default). For each fragment the shade chunk moves the shading point to the texel centre, then evaluates the lamp: a smooth-windowed inverse-square falloff, N·L (wrapped for the flat sprite cards), quantised into a few flat **light steps** (the pixel-art convention, and what makes the edges easy to see), and one hard tap of the shadow map with a small normal offset. Only the ground takes the shadow (see Pitfalls).
3. **Tail.** A little bloom for the lantern, then tonemapping.

The inspector switches off **texel snapping** (the same lighting per pixel) and **shadows**, and has two views: **lighting** (light alone, no art) and **texel grid** (a checkerboard of texels, tinted per sprite). The before/after split shows per-pixel against per-texel lighting directly.

### What was measured

`tests/texel-lighting.test.ts` checks the arithmetic against an exact answer (an affine texel-to-world map, an arbitrary screen Jacobian, four points) and then the picture: it renders the texel grid view and the lighting view of a close-up at 480 × 270 and counts horizontally adjacent pixel pairs that lie in the same texel. Of 103,907 such pairs, per-pixel lighting splits 0.51 % with four light steps and 1.04 % with eight (a step edge runs between them); texel-snapped lighting splits none. Smooth light (no steps) changes by less than the output's one-step dither across a texel and cannot be told apart this way, though it is plain to see: per pixel the gradient is smooth across each texel, snapped it is a staircase of flat texels.

**UV seams.** Checked by eye from straight above where the two tiles meet (`experiments/texel-lighting-seams.test.ts`) and by reasoning about where derivatives come from:

- The texel grid runs straight across the join between the cobble and grass tiles, because both are placed a whole number of texels apart (96 texels = 6 world units). Tiles placed off the grid would get two grids that disagree at the join; nothing here guards against that.
- There is no seam along a quad's diagonal or at its edge. Both triangles of a quad lie in one plane with the same affine texel-to-world map, and helper invocations at an edge extrapolate their own primitive's attributes, so the inverted Jacobian is the same everywhere on the quad. (`discard` in the batcher's alpha test demotes to a helper invocation, so the derivatives after it are still valid; Dawn compiles the shade chunk without a uniformity error.)
- Where the sharp filter blends two texels' colours across one pixel, that pixel is lit as one of the two texels, because `floor(texel)` picks one. No fringe was visible in the shots, but it is a one-pixel mismatch by construction.
- A texel near a tile's edge is lit at its own centre, half a texel inside the tile, so neighbouring tiles' edge texels are lit one texel apart, as every other pair of neighbours is.

## Cost

Per fragment: four derivatives, a 2 × 2 solve, one shadow-map tap and the lamp. The shadow pass draws the scene once more into a 1024² depth map. A study run on Dawn on an Apple M1 Max put the effect under a millisecond per frame at 1080p, but the GPU was shared with other work during the run and the marginal costs scattered, so no number is recorded in the scorecard. Not measured in a browser. Memory: the shadow map (4 MB) and the batcher's art (about 280 kB: seven layers of 99 × 99 texels, plus the lantern's own small batch).

## Pitfalls

- **Only flat geometry.** The solve assumes world position is affine in texel coordinates across the primitive, which is exact for the batcher's quads and for flat tiles. On a curved or skinned mesh it is a first-order estimate and texels on a curve would be lit at slightly wrong points.
- **Minified art falls back to per-pixel lighting.** Snapping fades out between one and two texels per pixel, because one centre per pixel at that density is nearest sampling of the light and would shimmer.
- **Sprites do not take the shadow.** In the shadow pass a card turns to face the lamp, in the colour pass to face the camera, so a sprite would shadow itself in stripes. A sprite standing in another's shadow is therefore lit; story 3.4's techniques are the place to fix that.
- **The batcher's upright normal points away from the camera.** For `upright` sprites `batch.wgsl` builds the normal as `(right.z, 0, -right.x)`, which faces away from the viewer, while camera-facing sprites get one that faces it. The shade chunk turns the normal toward the eye to cope; the batcher itself should be fixed.
- **One hard shadow tap** is deliberate here, to show where the edge lands; with PCF the snapped point should still be used for every tap.
- **Smooth light shows the difference less** than stepped light, because a gradient across a texel is subtle; the effect defaults to four steps.
- **Pixel stability with a moving camera is unchecked.** The camera stands still here; the moving light changes whole texels at a time, which is the intent.

## When to use it

Whenever pixel art is lit and magnified, which in this gallery is the HD path's normal case: light pools, torchlight and shadows that respect the art's grid look painted rather than projected. Tier B with its shadow map. Later effects can include `texel-snap.wgsl` in their shade chunk and call `texel_centre_world(f.texel, f.world)` before lighting; without stepped light or hard shadows the difference is small and per-pixel lighting is the cheaper choice.

## References

Written from memory and not re-checked while writing (no network).

- Brian Karis, "Real Shading in Unreal Engine 4", SIGGRAPH 2013 course notes: the windowed inverse-square falloff used for the lamp.
- t3ssel8r's devlog videos on YouTube show lighting quantised to the texel grid in a pixel-art 3D renderer; the exact technique there (it may use a different route to the texel centre) was not re-checked.
- WGSL: `dpdx`/`dpdy`, the derivative uniformity rules, and `discard` demoting to a helper invocation: <https://www.w3.org/TR/WGSL/>.
- texel-sampling's notes (in this gallery) for why one sample per pixel of minified art crawls.
