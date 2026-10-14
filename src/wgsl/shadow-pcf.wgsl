// shadow-pcf.wgsl -- percentage-closer filtering of a depth shadow map (story 3.4).
//
// `cmp` is a comparison sampler with compare 'less': a tap returns 1 where `depth_ref` is nearer the
// light than the stored depth (lit) and 0 where it is not (in shadow). With linear filtering the
// hardware blends the four nearest results, so each tap is already a 2×2 PCF in core WebGPU, with no
// feature needed (docs/support-matrix.md, section 5). The NxN loop widens that to soft edges.
//
// textureSampleCompareLevel rather than textureSampleCompare: it takes no derivatives, so it may be
// called after a discard or inside a loop, which a sprite's shade chunk always is.
//
// Self-contained (no #include), so it can be pasted into the sprite batcher's shade chunk.

// `uv` 0..1 across the map (y down), `depth_ref` the receiver's depth in the light's view, `radius` the
// tap spacing in texels. `taps` is the side of the kernel: 1 is a single (2×2 hardware) tap.
fn shadow_pcf(
  map: texture_depth_2d,
  cmp: sampler_comparison,
  uv: vec2f,
  depth_ref: f32,
  radius: f32,
  taps: i32,
) -> f32 {
  // Outside the map nothing was drawn, so nothing casts a shadow there.
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || depth_ref >= 1.0) {
    return 1.0;
  }
  let texel = radius / vec2f(textureDimensions(map));
  let half = f32(taps - 1) * 0.5;
  var sum = 0.0;
  for (var y = 0; y < taps; y++) {
    for (var x = 0; x < taps; x++) {
      let offset = (vec2f(f32(x), f32(y)) - half) * texel;
      sum += textureSampleCompareLevel(map, cmp, uv + offset, depth_ref);
    }
  }
  return sum / f32(taps * taps);
}

// A world position in the shadow map's space: xy as 0..1 texture coordinates, z as depth.
fn shadow_coords(light_view_proj: mat4x4f, world: vec3f) -> vec3f {
  let clip = light_view_proj * vec4f(world, 1.0);
  let ndc = clip.xyz / clip.w;
  return vec3f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5, ndc.z);
}
