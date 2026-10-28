// sprite-light-common.wgsl -- the half of story 3.3's sprite lighting that needs no sprite batcher:
// point-light attenuation, Lambert, rim, light bands and OKLab. Self-contained, so a fullscreen
// pass can `#include "sprite-light-common.wgsl"` (the pointer-lit sprite, story 9.2) and get the
// same light as the batcher. src/gpu/lighting/sprite-light.ts pastes it in front of
// sprite-light.wgsl for the batcher's shade chunk.
//
// Conventions: lighting is in linear light; positions, normals and directions share one frame.

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
