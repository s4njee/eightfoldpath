// sprite-light.wgsl -- lighting helpers for the sprite batcher's shade chunk (story 3.3).
//
// Not included with #include: the batcher compiles its shade chunk from a string, so an effect
// pastes this text in front of its own `sprite_shade` (src/gpu/lighting/sprite-light.ts does it).
// It uses what batch.wgsl declares around the chunk: `view`, `normal_map` and `SpriteFragment`.
//
// Conventions: normal maps are tangent space with x right, y up the image and z toward the viewer
// (src/gpu/lighting/normals.ts writes them that way). Lighting is in world space, linear light.

// World-space tangent (x), bitangent (y) and normal (z) of the quad the fragment is on, matching
// the corners batch.wgsl builds for each facing. The normal is the batcher's own, which faces the
// camera for upright and camera-facing sprites and points up for ground tiles.
fn sprite_light_frame(f: SpriteFragment) -> mat3x3f {
  if (f.facing == FACING_GROUND) {
    // Image up runs toward -z on the ground (batch.wgsl flips v for ground quads).
    return mat3x3f(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, -1.0), vec3f(0.0, 1.0, 0.0));
  }
  if (f.facing == FACING_CAMERA) {
    return mat3x3f(normalize(view.right.xyz), normalize(view.up.xyz), f.normal);
  }
  let t = normalize(vec3f(view.right.x, 0.0, view.right.z));
  return mat3x3f(t, vec3f(0.0, 1.0, 0.0), f.normal);
}

// The tangent-space normal stored for this texel. A mirrored sprite mirrors its normals too.
fn sprite_light_tangent_normal(f: SpriteFragment) -> vec3f {
  let size = vec2i(textureDimensions(normal_map));
  // A 1×1 map is the batcher's stand-in when the effect gave no normals: flat.
  if (size.x == 1 && size.y == 1) {
    return vec3f(0.0, 0.0, 1.0);
  }
  let at = clamp(vec2i(floor(f.texel)), vec2i(0), size - 1);
  var n = textureLoad(normal_map, at, f.layer, 0).rgb * 2.0 - 1.0;
  if (f.flip_x) {
    n.x = -n.x;
  }
  return normalize(n);
}

fn sprite_light_normal(f: SpriteFragment) -> vec3f {
  return normalize(sprite_light_frame(f) * sprite_light_tangent_normal(f));
}

// Attenuation that is 1 at the light and falls smoothly to exactly 0 at `range`: the window of
// Unreal Engine 4's shading notes times a softened inverse square scaled to the range, so the
// light's reach is one number and a light only touches what is near it.
fn sprite_light_attenuation(distance_sq: f32, range: f32) -> f32 {
  let ratio = distance_sq / max(range * range, 1e-4);
  let window = clamp(1.0 - ratio * ratio, 0.0, 1.0);
  return window * window / (1.0 + 4.0 * ratio);
}

// Diffuse response to a point light: Lambert times attenuation, before the light's colour.
fn sprite_light_point(world: vec3f, n: vec3f, light_pos: vec3f, range: f32) -> f32 {
  let d = light_pos - world;
  let distance_sq = dot(d, d);
  let l = d * inverseSqrt(max(distance_sq, 1e-6));
  return max(dot(n, l), 0.0) * sprite_light_attenuation(distance_sq, range);
}

// Rim: strongest where the surface turns away from the viewer and toward `direction` (a light
// behind and above). A flat card faces the viewer everywhere, so it gets none.
fn sprite_light_rim(n: vec3f, to_eye: vec3f, direction: vec3f, power: f32) -> f32 {
  let edge = pow(1.0 - clamp(dot(n, to_eye), 0.0, 1.0), power);
  return edge * clamp(dot(n, direction) * 0.75 + 0.25, 0.0, 1.0);
}

// Light quantised into `bands` flat steps, as a pixel artist shades: rounding rather than flooring,
// so a band boundary sits halfway between two levels and a fully lit surface stays fully lit.
fn sprite_light_bands(x: f32, bands: f32) -> f32 {
  if (bands < 1.0) {
    return x;
  }
  return floor(x * bands + 0.5) / bands;
}

// OKLab (Björn Ottosson, 2020) from linear sRGB, for choosing the nearest palette colour by eye
// rather than by RGB distance.
fn sprite_light_oklab(c: vec3f) -> vec3f {
  let lms = mat3x3f(
    vec3f(0.4122214708, 0.2119034982, 0.0883024619),
    vec3f(0.5363325363, 0.6806995451, 0.2817188376),
    vec3f(0.0514459929, 0.1073969566, 0.6299787005),
  ) * max(c, vec3f(0.0));
  let root = pow(max(lms, vec3f(1e-9)), vec3f(1.0 / 3.0));
  return mat3x3f(
    vec3f(0.2104542553, 1.9779984951, 0.0259040371),
    vec3f(0.7936177850, -2.4285922050, 0.7827717662),
    vec3f(-0.0040720468, 0.4505937099, -0.8086757660),
  ) * root;
}
