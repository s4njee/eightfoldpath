// The outline G-buffer for sprites (story 3.7): a shade-chunk helper for the sprite batcher.
//
// Not compiled on its own. `src/gpu/lighting/outline.ts` imports it as text and pastes it into a
// batcher `shade` chunk, where `SpriteFragment` and `view` are in scope (batch.wgsl).
// Drawn into an `rgba16float` target, the result is what `outline.wgsl` reads:
//
//   r, g: the surface normal in view space, as dot products with the camera's right and up. The
//         third component is implied: every surface the camera can see faces it.
//   b:    the object ID. 0 is the sky (the clear value), 1 is terrain, sprite i is i + 2.
//
// Ground tiles all share the terrain ID, so the seams between tiles never draw a line; only real
// changes of height or slope do.

const OUTLINE_TERRAIN_ID = 1.0;

// The batcher's `sprites` buffer is visible to the vertex stage only, so the facing is recovered
// from the fragment's normal: ground tiles are exactly (0, 1, 0), upright sprites are horizontal,
// camera-facing ones are neither.
fn outline_is_ground(f: SpriteFragment) -> bool {
  return abs(f.normal.x) + abs(f.normal.z) < 1e-4;
}

fn outline_sprite_normal(f: SpriteFragment) -> vec3f {
  if (outline_is_ground(f)) {
    return vec3f(0.0, 1.0, 0.0);
  }
  if (abs(f.normal.y) > 1e-4) {
    // Camera-facing: straight back at the eye.
    return normalize(cross(view.right.xyz, view.up.xyz));
  }
  // Upright sprites turn about the vertical axis to face the camera. Rebuilt here rather than
  // taken from the fragment, whose sign points away from the camera for this facing.
  let right = normalize(vec3f(view.right.x, 0.0, view.right.z));
  return vec3f(-right.z, 0.0, right.x);
}

fn outline_gbuffer(f: SpriteFragment) -> vec3f {
  let normal = outline_sprite_normal(f);
  let id = select(f32(f.index) + 2.0, OUTLINE_TERRAIN_ID, outline_is_ground(f));
  return vec3f(dot(normal, view.right.xyz), dot(normal, view.up.xyz), id);
}
