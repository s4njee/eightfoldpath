// light.wgsl -- how a diorama is lit, shared by its terrain and its sprites (stage.ts).
//
// Not included with #include: the terrain and the sprite batcher compile their shade chunks from
// strings, so stage.ts pastes this text, shadow-pcf.wgsl and the generated `DioramaLight` struct in
// front of each one's own shade function. Everything here lives in group 2.
//
// The light is a sun with a shadow map, hemisphere ambient (sky above, bounced ground light
// below) and a handful of unshadowed point lights: the minimum a lit diorama needs. Stories 4.5 to
// 4.7 refine each part.

@group(2) @binding(0) var<uniform> light: DioramaLight;
@group(2) @binding(1) var shadow_map: texture_depth_2d;
@group(2) @binding(2) var shadow_cmp: sampler_comparison;

const DIORAMA_VIEW_ALBEDO = 1.0;
const DIORAMA_VIEW_LIGHTING = 2.0;
const DIORAMA_VIEW_NORMALS = 3.0;
const DIORAMA_VIEW_HEIGHTS = 4.0;

// 1 where the sun reaches `world`, 0 in full shadow. The point is pushed out along the normal by
// about a map texel, which removes acne on slopes without a large depth bias detaching shadows
// from their casters.
fn diorama_shadow(world: vec3f, n: vec3f) -> f32 {
  if (light.shadows_on < 0.5) {
    return 1.0;
  }
  let at = shadow_coords(light.light_view_proj, world + n * light.normal_offset);
  return shadow_pcf(shadow_map, shadow_cmp, at.xy, at.z - light.bias, light.pcf_radius, 3);
}

// sprite-light.wgsl's attenuation: 1 at the light, exactly 0 at `range`.
fn diorama_attenuation(distance_sq: f32, range: f32) -> f32 {
  let ratio = distance_sq / max(range * range, 1e-4);
  let window = clamp(1.0 - ratio * ratio, 0.0, 1.0);
  return window * window / (1.0 + 4.0 * ratio);
}

// Lambert, wrapped by `wrap` (0 for terrain; sprites stand in for round bodies, so their unlit
// side is dim rather than black).
fn diorama_lambert(n: vec3f, l: vec3f, wrap: f32) -> f32 {
  return clamp(dot(n, l) * (1.0 - wrap) + wrap, 0.0, 1.0);
}

fn diorama_points(world: vec3f, n: vec3f, wrap: f32) -> vec3f {
  var sum = vec3f(0.0);
  if (light.points_on < 0.5) {
    return sum;
  }
  for (var i = 0u; i < u32(light.point_count); i++) {
    let p = light.point_position[i];
    let d = p.xyz - world;
    let distance_sq = max(dot(d, d), 1e-6);
    let l = d * inverseSqrt(distance_sq);
    sum += light.point_color[i].rgb * diorama_lambert(n, l, wrap)
      * diorama_attenuation(distance_sq, p.w);
  }
  return sum;
}

// Light arriving at a surface, before its albedo.
fn diorama_irradiance(world: vec3f, n: vec3f, wrap: f32, sun_visible: f32) -> vec3f {
  let hemisphere = mix(light.ground, light.sky, n.y * 0.5 + 0.5);
  let sun = light.sun_color * diorama_lambert(n, light.to_sun, wrap) * sun_visible;
  return hemisphere + sun + diorama_points(world, n, wrap);
}

// The finished colour, or what the layer inspector asked to see instead.
fn diorama_output(albedo: vec3f, irradiance: vec3f, n: vec3f, world: vec3f) -> vec3f {
  if (light.view_mode == DIORAMA_VIEW_ALBEDO) {
    return albedo;
  }
  if (light.view_mode == DIORAMA_VIEW_LIGHTING) {
    return irradiance * 0.5;
  }
  if (light.view_mode == DIORAMA_VIEW_NORMALS) {
    return n * 0.5 + 0.5;
  }
  if (light.view_mode == DIORAMA_VIEW_HEIGHTS) {
    // Blue at the bottom to warm at the top, with a dark line at every height step, so the height
    // map can be read off the picture.
    let t = clamp(world.y / max(light.height_range, 1e-3), 0.0, 1.0);
    let ramp = mix(vec3f(0.05, 0.12, 0.4), vec3f(1.0, 0.55, 0.15), t);
    let step = fract(world.y / max(light.height_step, 1e-3));
    return ramp * select(1.0, 0.35, step < 0.04 || step > 0.96);
  }
  return albedo * irradiance;
}
