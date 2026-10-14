## How it works

Every sprite in the scene, the ground tiles included, is one instance of one draw call. The batcher (`src/gpu/sprites/batch.ts`, `batch.wgsl`) keeps a storage buffer with an entry per sprite: where it stands, how it faces, its size, which layer of the texture array its art is in, the rectangle of its first frame, its flipbook timing, a tint and a hit-flash amount. The vertex stage builds each quad from the vertex index:

- **upright** sprites stand on their feet and turn about the vertical axis to face the camera, but never lean back, so they stay upright as the camera looks down on them. This is how characters and props stand in a diorama.
- **camera** sprites face the camera fully, so they tilt back with it. At a 35° pitch they visibly lean; they are the right choice for particles and glows, not for characters.
- **ground** sprites lie flat, for tiles.

The art for every sprite is packed into one `2d-array` texture, one image per layer. A flipbook is a strip of frames left to right in the image; the vertex stage picks the frame from the scene clock and the sprite's own rate, so the slime animates at 6 frames a second whatever the canvas does. The fragment stage reads the art with one of the three sampling modes in `src/wgsl/sampling.wgsl` (story 3.1 compares them), cuts out transparent texels, and hands what is left to `sprite_shade`, a WGSL chunk each effect supplies. Here it returns the art unlit; lighting (3.3), outlines (3.7) and palette work plug in the same way. `drawDepth` draws the same cut-out quads into a depth-only target from another view, which is how sprites will cast shadows (3.4).

**Cut-out edges.** The art has alpha of exactly 0 or 1, so the obvious cut-out is a hard test: keep a fragment if alpha is above one half. Under a moving camera its edge steps and crawls. With 4× MSAA and alpha-to-coverage instead, the alpha the sampler returns becomes the fraction of samples covered. Nearest sampling gives no fractional alpha, so coverage changes little; sharp sampling blends alpha across one screen pixel at the edge of the art, and coverage turns that into a properly antialiased silhouette. The default is sharp sampling with alpha-to-coverage. The scene targets (`src/gpu/sprites/targets.ts`) draw into a multisampled `rgba16float` target that resolves into the HDR tail's scene.

The scene goes through the tail with bloom and tonemapping off, so the unlit sprites keep the colours they were drawn in.

## Cost

Not measured yet. It is one instanced draw of a dozen quads plus the tail. Alpha-to-coverage needs 4× MSAA, which multiplies the colour and depth memory of the pass by four; at 1080p the multisampled `rgba16float` colour target alone is about 66 MB of samples. That is the number to watch on phones.

## Pitfalls

- **Upright sprites are flat cards.** Seen from the side they are thin; seen from above they show their whole height. The orbiting camera makes this obvious when it passes a quarter turn. HD-2D scenes keep the camera within a narrow range of angles for this reason.
- **Sprite order is only depth.** Opaque cut-outs need no sorting, but anything partly transparent would; the batcher draws in the order given.
- **Texture-array layers are as large as the largest image.** Eleven images pad to 120 × 99 texels each. Fine for a test scene; a real atlas packs several images per layer.
- **The art is at twice the planned texel density for characters**, so the cast stands about four tiles tall (see `hello`'s notes).
- **Hit flash** pushes toward white after shading. At its default (once a second, a fifth of a second long, on one small sprite) it is far below the flash threshold; on a large sprite it would not be.

## When to use it

Always: every later effect draws its sprites with this batcher. Sharp sampling with alpha-to-coverage is the default; drop to a hard cut-out without MSAA where memory is tight, and accept the crawling edge.

## References

- WebGPU alpha-to-coverage and multisampling: <https://gpuweb.github.io/gpuweb/#dom-gpumultisamplestate-alphatocoverageenabled>
- This repository's `docs/support-matrix.md` on MSAA with `rgba16float` and what alpha-to-coverage needs.
