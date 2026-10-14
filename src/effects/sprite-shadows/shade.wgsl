// The sprite batcher's shade for story 3.4, shared by the ground batch and the cast batch.
//
// The ground receives the shadow: from the blobs (analytic discs under each caster) or from the
// shadow map, read with PCF. Sprites are lit by the sun through their automatic normals and do not
// receive shadows themselves. The batcher compiles this from a string after sprite-light.wgsl,
// shadow-pcf.wgsl and the generated `ShadowParams` struct (index.ts).

const MODE_BLOB = 0.0;
const VIEW_SHADOW = 1.0;

@group(2) @binding(0) var<uniform> shadow: ShadowParams;
@group(2) @binding(1) var shadow_map: texture_depth_2d;
@group(2) @binding(2) var shadow_linear: sampler_comparison;
@group(2) @binding(3) var shadow_nearest: sampler_comparison;

// 1 where the sun reaches the ground, 0 in full shadow.
fn sun_visibility(world: vec3f) -> f32 {
  if (shadow.shadows_on < 0.5) {
    return 1.0;
  }
  if (shadow.mode == MODE_BLOB) {
    // A soft disc under each caster's feet, the oldest trick: it says "standing here" and nothing
    // about where the light is.
    var occlusion = 0.0;
    for (var i = 0u; i < u32(shadow.blob_count); i++) {
      let blob = shadow.blobs[i];
      let d = length(world.xz - blob.xy) / blob.z;
      occlusion = max(occlusion, 1.0 - smoothstep(0.45, 1.0, d));
    }
    return 1.0 - occlusion;
  }
  let at = shadow_coords(shadow.light_view_proj, world);
  let depth_ref = at.z - shadow.bias;
  if (shadow.pcf_on < 0.5) {
    return shadow_pcf(shadow_map, shadow_nearest, at.xy, depth_ref, 1.0, 1);
  }
  return shadow_pcf(shadow_map, shadow_linear, at.xy, depth_ref, shadow.pcf_radius, i32(shadow.pcf_taps));
}

fn sprite_shade(f: SpriteFragment) -> vec3f {
  let albedo = f.color.rgb;
  let sun = shadow.sun_color * shadow.sun_intensity;
  if (f.normal.y > 0.9999) {
    // The ground: the shadow takes away the sun, and a little of the sky light with it, so a
    // shadow still reads where the sun is low.
    let visible = mix(1.0 - shadow.strength, 1.0, sun_visibility(f.world));
    if (shadow.view == VIEW_SHADOW) {
      return vec3f(visible);
    }
    let direct = sun * max(shadow.sun_direction.y, 0.0) * visible;
    return albedo * (shadow.ambient * mix(1.0, visible, 0.4) + direct);
  }
  if (shadow.view == VIEW_SHADOW) {
    // Casters in a flat mid grey, so where a shadow meets its caster's feet can be judged.
    return vec3f(0.55, 0.6, 0.7);
  }
  if (shadow.sprite_light_on < 0.5) {
    return albedo;
  }
  let n = sprite_light_normal(f);
  // Half-Lambert wrap: a sprite is a stand-in for a round body, so its unlit side is dim rather
  // than black.
  let diffuse = clamp(dot(n, shadow.sun_direction) * 0.6 + 0.4, 0.0, 1.0);
  return albedo * (shadow.ambient + sun * diffuse);
}
