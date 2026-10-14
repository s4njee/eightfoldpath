## How it works

Three columns stand side by side, each with the same two characters on the same tile and its own lantern at the same place relative to it. Only the normals differ, left to right:

1. **Flat.** The sprite is a card facing the camera. Every texel has the same normal, so a light changes the card's brightness as a whole and nothing else.
2. **Painted.** The silhouette rounding from (3), plus relief taken from the art's own lightness: light texels read as raised, dark ones as grooves. The test art has no hand-painted normal maps, so this stands in for one and shows what surface detail adds on top of the silhouette.
3. **Automatic.** A normal map generated from the alpha alone (`src/gpu/lighting/normals.ts`). The exact Euclidean distance from each opaque texel to the nearest transparent one is computed on the CPU at load (Felzenszwalb and Huttenlocher's two-pass transform), read as a height that rises over `radius` texels in a quarter circle and then levels off, lightly blurred, and differentiated into a tangent-space normal. Flipbook strips are processed one frame at a time so neighbouring frames do not round into each other.

The plan names a jump-flood distance field for this. Jump flooding is the GPU way to approximate the same field; for sprites of a few thousand texels the exact CPU transform takes about a millisecond per sprite (measured with `experiments/sprite-light-normals-timing.test.ts`, 0.1 to 1 ms each across `assets/sprites`), needs no GPU round trip and gives the same bytes on every machine. A GPU version only pays once the art is large or changes every frame.

Everything is one sprite-batcher draw. The batcher takes one normal map per sheet, so each character is loaded three times with a different normal map beside it, and which column a sprite is in is just which sheet it uses: the shader never branches on the mode. The shade chunk (`shade.wgsl`, after the shared helpers in `src/wgsl/sprite-light.wgsl`) does, per fragment:

- **Frame.** Rebuilds the quad's tangent frame (right, up, facing) from the camera, recognising upright, camera-facing and ground quads from the interpolated normal, and turns the stored normal into world space.
- **Point lights.** Lambert times an attenuation that is 1 at the light and exactly 0 at its range (the windowed falloff from Karis's Unreal Engine 4 notes), so each lantern lights only its own column. The lanterns orbit, or follow the pointer across a plane in front of the cast, keeping the same offset in every column.
- **Rim.** A cool light from behind and above, strongest where the normal turns away from the viewer. A flat card faces the viewer everywhere, so it gets no rim at all; that is the clearest single difference between the columns.
- **Palette-preserving light.** `steps` (the default) rounds each light's contribution and the rim to a few levels, so shading falls in flat bands as an artist would paint it. `palette` does that and then snaps the shaded colour to the nearest of the 48 colours of `assets/palette/eightfold.png` by OKLab distance, and the tail's output dither is switched off, so sprite and ground pixels reach the screen as palette colours. Measured on the `palette ramps` preset at 960 × 540: 89% of the pixels that are not the plain background are exact palette colours; the rest are where the lanterns' bloom and the antialiased cut-out edges blend colours (expected from how the frame is built, not checked pixel by pixel).

The tail runs without tonemapping, so lit colours reach the screen as computed; only the lantern markers, far above white, bloom.

## Cost

Not measured: the GPU was shared with other work while this was written, so no Dawn or Chrome timing was taken. What scales it: one batcher draw at 4× MSAA with alpha-to-coverage, and per sprite fragment a loop over three lights (one in single layout) plus, in `palette` mode, a 48-step nearest-colour loop. That loop is cheap for a few thousand sprite pixels but would not be for a full-screen pass, which should use story 3.5's lookup texture instead. Normal generation is a load-time CPU cost of about 1 ms per sprite. Each character is held three times in the texture array (two sprites of under 70 × 70 texels, so a few tens of kilobytes); a real scene picks one normal mode and holds each sheet once.

## Pitfalls

- **Normal maps come back sRGB-decoded.** The batcher packs normals into the same `rgba8unorm-srgb` array type as the art, so `textureLoad` returns decoded values. `sprite-light.wgsl` encodes them again before use. A shade chunk that reads `normal_map` directly gets normals bent toward the viewer's lower left.
- **The batcher's upright normal points away from the camera.** `sprite_light_frame` rebuilds the facing normal instead of using `SpriteFragment.normal`, and only uses that field to tell the three facings apart.
- **Mirrored sprites need mirrored normals, and the fragment stage cannot see the flag.** The batcher's instance buffer is visible to the vertex stage only, so the caller passes `flip_x` itself. Nothing in this scene is mirrored.
- **Distance falloff dominates up close.** With the lantern a couple of units from a sprite four units tall, the falloff changes more across the sprite than the normal does. On a flat card, quantised light then draws concentric rings rather than form; that is part of why flat sprites look wrong under a nearby light.
- **The rounding has a staircase.** Distances are measured between texel centres, so the bevel steps a little on diagonals; one blur pass hides most of it. Very thin parts (the mage's staff, a sword) are narrower than the bevel and become a ridge with no flat top.
- **Painted relief is guesswork.** Lightness is not height. Dark outlines turn into grooves and highlights into bumps, so the relief mostly adds noise at this texel size. A real hand-painted normal map would do better; the art set has none.
- **Snapping to the palette shifts hue under coloured light.** The palette has few neutral greys, so lit cobbles under the warm lantern snap to browns and oranges. That is the palette doing its job, but it reads as a colour change rather than a brightness change.
- **Rim on dark cloth is weak.** The rim keeps a little of its own colour (`albedo + 0.15`) so it shows on the mage's dark robe; a pure multiply would hide it.

## When to use it

Automatic normals are the default for any lit sprite that has no hand-painted normal map: they cost nothing at run time, and edge light and rim are what make a sprite look like it stands in the light rather than having a filter laid over it. Flat normals are only right for sprites lit from the front and never from the side. Use `steps` for the pixel-art look (three bands, as here) and `palette` when the frame must stay in the artist's colours, for example on the low-resolution path (story 3.8). Tier B as a lit diorama piece; a single pointer-lit portrait with one light (story 9.2) should fit Tier A, but neither has been measured.

## References

- Pedro Felzenszwalb and Daniel Huttenlocher, _Distance Transforms of Sampled Functions_, Theory of Computing 8 (2012): <https://theoryofcomputing.org/articles/v008a019/>
- Guodong Rong and Tiow-Seng Tan, _Jump Flooding in GPU with Applications to Voronoi Diagram and Distance Transform_ (I3D 2006): the GPU alternative the plan names, not used here.
- Brian Karis, _Real Shading in Unreal Engine 4_ (SIGGRAPH 2013 course notes): the windowed inverse-square falloff.
- Björn Ottosson, _A perceptual color space for image processing_ (2020): <https://bottosson.github.io/posts/oklab/>
