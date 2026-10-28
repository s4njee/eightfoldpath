// sprite-light.wgsl -- lighting helpers for the sprite batcher's shade chunk (story 3.3).
//
// Not included with #include: the batcher compiles its shade chunk from a string, so an effect
// pastes this text in front of its own `sprite_shade` (src/gpu/lighting/sprite-light.ts does it).
// It uses what batch.wgsl declares around the chunk: `view`, `normal_map` and `SpriteFragment`.
//
// Conventions: normal maps are tangent space with x right, y up the image and z toward the viewer
// (src/gpu/lighting/normals.ts writes them that way). Lighting is in world space, linear light.
//
// The helpers that need no batcher (attenuation, Lambert, rim, bands, OKLab) are in
// sprite-light-common.wgsl, which sprite-light.ts pastes in front of this file.

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
