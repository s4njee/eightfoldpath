## How it works

**The scene format (4.1).** A scene is a grid of columns, one world unit square. `assets/scenes/village.json` is written by hand: a legend that says what each character means (the art on top, the art on the sides, and whether it is a block, stairs or a slope), the map as rows of those characters, north first, and the heights as rows of digits, each a step of `heightStep` world units (half a unit here). Lights, the camera and the sprites go in the same file. Larger scenes can give the map and the heights as images painted in any editor instead: the legend's keys become hex colours and the height is the red channel. `parseScene` (`src/gpu/diorama/scene.ts`) validates it all, says which row and column a bad character is at, finds which way each flight of stairs and each slope climbs (toward its higher neighbour unless the file says), and puts every sprite's feet on the ground under it with `heightAt`, which follows stairs and slopes. The same file always gives the same scene: art names come out sorted and everything else in the order written.

**The tile extruder (4.2).** `extrude` (`src/gpu/diorama/extrude.ts`) turns every column into one box: a top through four corner heights (tilted for a slope) and four sides, each running down only as far as the ground beside it. Where a neighbour is as high, that side's bottom is above its top and the vertex stage collapses it to a line, so hidden faces cost a few vertices and no pixels. Stairs become one box per tread, a quarter unit high. `createTerrain` (`terrain.ts`, `terrain.wgsl`) puts every box in a storage buffer and draws them all with **one instanced draw call** of 30 vertices each: 402 boxes for the village, stairs included. The village needs no auto-tile art: three tricks in the fragment stage stand in for it.

- **Art by world position.** Tops and walls are mapped at the shared 16 texels a unit, so terrain and sprites have the same texel size. A 99-texel tile image covers about six cells and repeats; the sampling is story 3.1's sharp filter, wrapped inside each image's own size so the padding of the texture array never bleeds in.
- **Walls mapped from the top edge down.** A wall's texture starts at its top whatever its height, so the cliff image's grass fringe always sits along the top of a drop, on a half-unit step and a two-unit cliff alike.
- **Dithered seams.** Where two tops of different art meet at the same height, each side gives way to the other with a chance that falls from a half at the edge to nothing three texels in, decided per texel. The boundary frays in whole texels, the way a pixel artist would draw it, from both sides at once.

A **rim** brightens the outermost texel of a top above a drop, which reads as light catching a ledge.

**The stage.** `createDioramaStage` (`src/gpu/diorama/stage.ts`) is what later effects build on: the terrain and a sprite batcher sharing one camera view and one depth buffer, 4× MSAA with alpha-to-coverage on the sprites, a 2048² shadow map from the sun that terrain and sprites both cast into, hemisphere ambient, and up to eight unshadowed point lights (the two lamps). Sprites take their shadow as a whole, read from the ground on the sun's side of their feet: read at the quad itself, the map would hold the sprite's own light-facing card. The lighting is in `light.wgsl`, shared by both shade chunks so the terrain and the sprites are lit alike.

The inspector shows the **albedo**, the **lighting** alone, the **normals**, the **heights** (a ramp with a line at every step, so the height map can be read off the picture) and the **shadow map**, and switches off shadows, lamps, the seam dither, the rim or the sprites.

## Cost

Measured on an Apple M1 Max on Dawn (`npm run study -- --epic 4`, [docs/studies/epic-4.md](../../../docs/studies/epic-4.md)), marginal cost per frame including the HDR tail: **1.16 ms at 1920 × 1080 and 0.59 ms at 1266 × 585**. The sun's shadows cost about a quarter of a millisecond (0.92 ms without them at 1080p, 0.46 at the smaller size); the lamps about 0.1. The tail alone measured 0.68 ms at 1080p, so the diorama itself is about half a millisecond. Inside the Tier B budget of 6 ms, on a faster GPU than that budget is set for. The shape: a shadow pass and a scene pass, the terrain one draw of 402 instances (12,060 vertices; 1,404 of the 1,608 sides collapse to lines) and the sprites one draw of 15 quads. The 4× multisampled `rgba16float` colour target dominates memory, about 66 MB at 1080p (story 3.2). The art is 16 small PNGs and the scene file, 104 KB in all.

## Pitfalls

- **Tiles are not seamless yet** (`seamless: false` in the manifest), so a faint grid shows where each 99-texel image repeats, about every six cells. Seamless tiles are an art task, not a renderer one.
- **The art is twice the planned density for characters**, so the knight stands taller than a two-unit cliff. A stand-in for proper character art (see `hello`'s notes).
- **Small canvases minify the art.** At 640 × 360 a texel is about one screen pixel and the picture pops twice as much as a supersampled reference under motion; at 1280 × 720 it pops no more than the reference (`experiments/diorama-stability.test.ts`).
- **Walls only go down to the lowest neighbour along an edge.** Beside stairs or a slope a wall runs under them, hidden by depth, rather than following the steps.
- **A wall's top edge follows the top of its own column**, so the grass fringe sits under a slope's rising edge too; on stairs it would show on every tread, which is why the village's stairs use stone sides.
- **An empty timed pass misreads.** With the shadows off, an empty shadow pass (cleared, nothing drawn) made the study read 1.68 ms instead of 0.92 and one frame's span 186 ms, probably because an empty pass's timestamps on Apple Silicon do not bracket any work. The stage now skips the pass when nothing will read the map.
- **Sprites in shadow are shadowed all at once**: a sprite half in a cliff's shadow is either lit or not, decided at its feet.

## When to use it

Whenever an effect needs ground to stand on: the diorama is the stage for depth of field, weather, battle effects and the eight scenes, and a page can describe its own little place in a JSON file. Tier B provisionally: two passes, shadows and MSAA. For Tier A, drop the shadow map and MSAA, or use flat parallax layers (`parallax-header`).

## References

- t3ssel8r, videos on 3D pixel-art rendering: texel-density terrain and lighting.
- Acquire and Square Enix, _The Fusion of Nostalgia and Novelty in the Development of Octopath Traveler_ (Unreal Fest Europe 2019).
- Bryce Bayer, _An Optimum Method for Two-Level Rendition of Continuous-Tone Pictures_ (1973), for dithering as a way to blend two flat colours.
- WebGPU, instanced drawing and storage buffers: <https://gpuweb.github.io/gpuweb/>
