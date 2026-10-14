## How it works

`hello` is the smallest thing that exercises the whole foundation: art loaded from `assets/`, a texture array, a 3D camera, depth, a light, and the HDR tail. It is one pixel-art sprite standing on one tile, lit by a lantern that circles it.

Everything is one render pass into the tail's `rgba16float` scene target, with a `depth24plus` buffer:

1. **Art.** The cleaned cobblestone tile and traveller sprite (`assets/tiles/cobblestone.png`, `assets/sprites/traveller.png`) are decoded to raw pixels by `loadPixels` and packed into one `2d-array` texture by `packTextureArray` (`src/gpu/assets.ts`), one image per layer, sampled with nearest filtering.
2. **Quads.** The ground, the sprite and the lantern's glow are three entries in a small storage buffer. The vertex stage builds each quad's corners from the vertex index: flat on the ground plane, a billboard locked to the vertical axis that stands on its feet, or a billboard that fully faces the camera.
3. **Lit pass.** The ground and the sprite are drawn opaque with a hard alpha cut, since the cleaned art has alpha of exactly 0 or 1. Light is a softened inverse square from the lantern. The ground uses its real normal and a soft contact shadow under the sprite's feet. The sprite has no normal, so it is treated as facing the camera, tilted up a little, with the falloff wrapped so its far side is dim rather than black.
4. **Glow pass.** The lantern is a camera-facing quad added on top, several times brighter than SDR white, so the tail's bloom turns it into a light.
5. **Tail.** `createHdrTail` blooms, tonemaps and encodes to the canvas, with the same four controls as every effect.

The camera follows plan.md's diorama default: a narrow field of view (25°) pitched 35° down, pulled back so the tile fills the frame. One tile is 16 texels, so the ground shows 64 texels of cobblestone across four world units, and the sprite is drawn at the same density.

## Cost

Not measured yet. It is one pass of three quads plus the tail, so the tail is expected to be most of it.

## Pitfalls

- **The sprite is twice the planned size.** The plan expects characters about two tiles tall (24 × 32 texels). The cleaned traveller is 35 × 68 texels, because the generator drew at about twice the requested detail. At the shared texel density it stands about four tiles tall. Rescaling would blur the pixel art; the art set needs a decision before Epic 3.
- **No anti-aliasing on the cutout.** The hard alpha cut aliases along the sprite's edge when the camera moves. Alpha-to-coverage with MSAA is story 3.2; `docs/support-matrix.md` covers what it needs.
- **Nearest sampling shimmers in perspective.** Story 3.1 compares the alternatives.
- **The contact shadow ignores the light.** It is a stand-in until story 3.4.

## When to use it

Never on a real page: it is a smoke test. Use it to check that asset loading, the texture array, depth, the lighting path and the tail all still work, and as the starting point for the sprite and diorama stories.

## References

- WebGPU texture arrays and `2d-array` views: <https://gpuweb.github.io/gpuweb/#dom-gputextureviewdimension-2d-array>
- The tail and its controls: Fire Temple's `docs/compositing-study.md`, inherited unchanged.
