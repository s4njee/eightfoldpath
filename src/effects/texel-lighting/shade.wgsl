// texel-lighting's shade chunk for the sprite batcher (src/gpu/sprites/batch.wgsl): a lamp lights
// the ground and the sprites, and its shadow map darkens the ground, all evaluated at the centre of
// each texel (texel-snap.wgsl) or, with snapping off, at each pixel.

#include "texel-snap.wgsl"
#include "lighting-params.wgsl"

@group(2) @binding(0) var<uniform> lighting: Lighting;
@group(2) @binding(1) var shadow_map: texture_depth_2d;
@group(2) @binding(2) var shadow_compare: sampler_comparison;

const VIEW_LIGHTING = 1u;
const VIEW_GRID = 2u;

// 1 where the lamp sees `world`, 0 where something nearer to it is in the way. One hard tap: the
// point of the scene is where the shadow's edge lands, and filtering would hide it.
fn lamp_shadow(world: vec3f, normal: vec3f) -> f32 {
  // A small step along the normal keeps the ground from shadowing itself.
  let clip = lighting.shadow_view_proj * vec4f(world + normal * lighting.shadow_bias, 1.0);
  let ndc = clip.xyz / clip.w;
  let uv = ndc.xy * vec2f(0.5, -0.5) + 0.5;
  if (clip.w <= 0.0 || any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || ndc.z > 1.0) {
    return 1.0;
  }
  return textureSampleCompareLevel(shadow_map, shadow_compare, uv, ndc.z);
}

// The lamp's light arriving at `world` on a surface facing `normal`, before the surface's colour.
fn lamp_light(world: vec3f, normal: vec3f, receives_shadow: bool) -> vec3f {
  let to_light = lighting.light_position - world;
  let distance = length(to_light);
  // A smooth window to zero at the radius (Karis 2013), so the pool of light has an edge to land.
  let window = clamp(1.0 - pow(distance / lighting.light_radius, 4.0), 0.0, 1.0);
  let falloff = window * window / (1.0 + distance * distance * 0.15);
  // Sprites are flat cards facing the camera; wrapping their N·L keeps a side-lit card from going
  // black at the edge of the light, as hello does.
  let facing = dot(normal, to_light / distance);
  let wrap = select(lighting.wrap, 0.0, normal.y > 0.5);
  var amount = falloff * clamp((facing + wrap) / (1.0 + wrap), 0.0, 1.0);
  // Quantised light, the pixel-art convention: a few flat steps instead of a gradient. This is
  // what makes the difference between per-pixel and per-texel edges easy to see.
  if (lighting.bands > 0.0) {
    amount = floor(amount * lighting.bands + 0.5) / lighting.bands;
  }
  var shadow = 1.0;
  if (receives_shadow && lighting.shadow_on > 0.5) {
    shadow = lamp_shadow(world, normal);
  }
  return lighting.light_color * amount * shadow;
}

fn sprite_shade(f: SpriteFragment) -> vec3f {
  // The derivatives in texel_centre_world are taken here, after the batcher's alpha test. WGSL's
  // `discard` only demotes an invocation to a helper, so control flow is still uniform and the
  // 2 × 2 neighbours are still there to difference against (checked: Dawn compiles this cleanly).
  let centre = texel_centre_world(f.texel, f.world);
  let at = select(f.world, centre, lighting.snap > 0.5);

  if (u32(lighting.view) == VIEW_GRID) {
    // The texel grid: a checkerboard of texels, tinted per sprite, for checking alignment by eye
    // and for tests/texel-lighting.test.ts, which compares it with the lighting view. Neighbouring
    // texels, across or down, always differ in brightness.
    let cell = vec2i(floor(f.texel));
    let parity = f32((cell.x + cell.y) & 1);
    let tint = vec3f(f32(f.index & 1u), f32((f.index >> 1u) & 1u), f32((f.index >> 2u) & 1u));
    return (0.5 + 0.5 * tint) * (0.12 + 0.6 * parity);
  }

  // The batcher's normal faces the camera for cards and points up for ground tiles.
  let normal = f.normal;
  // Only the ground takes the shadow: a sprite turns to face the lamp in the shadow pass and the
  // camera in this one, so it would shadow itself in stripes (notes.md, Pitfalls).
  let ground = f.normal.y > 0.5;
  let light = lighting.ambient + lamp_light(at, normal, ground);
  if (u32(lighting.view) == VIEW_LIGHTING) {
    return light;
  }
  return f.color.rgb * light;
}
