// texel-mips.wgsl -- sampling.wgsl's three modes over a mipmapped texture array (story 3.1).
//
// Same conventions as sampling.wgsl: coordinates in texels of level 0, and `texel_footprint` is
// `fwidth(texel)` taken by the caller in uniform control flow. Every read is an explicit-level
// one, so these can be called from anywhere, including after a discard.
//
// The level is log2 of the larger footprint component, plus `bias` (negative is sharper). `fwidth`
// is |dx| + |dy| per component, so where the texel grid is turned 45 degrees to the screen it
// overestimates the footprint by up to the square root of two, half a level coarser than the
// hardware's own choice. Like the hardware without anisotropic filtering, it is isotropic: a
// surface seen at a grazing angle is blurred along its short axis to stop aliasing on its long one.

fn texel_mip_lod(tex: texture_2d_array<f32>, texel_footprint: vec2f, bias: f32) -> f32 {
  let top = f32(textureNumLevels(tex) - 1u);
  return clamp(log2(max(max(texel_footprint.x, texel_footprint.y), 1e-6)) + bias, 0.0, top);
}

// Level-0 texel coordinates moved onto `level`, through the normalised UV so that odd sizes
// (99 texels -> 49 -> 24 ...) stay aligned with what the hardware filter does.
fn texel_at_level(tex: texture_2d_array<f32>, texel: vec2f, level: u32) -> vec2f {
  let base = vec2f(textureDimensions(tex, 0u));
  return texel / base * vec2f(textureDimensions(tex, level));
}

// Nearest texel of the nearest level ("nearest-mipmap-nearest").
fn texel_nearest_mip(
  tex: texture_2d_array<f32>,
  texel: vec2f,
  texel_footprint: vec2f,
  layer: i32,
  bias: f32,
) -> vec4f {
  let level = u32(round(texel_mip_lod(tex, texel_footprint, bias)));
  let size = vec2i(textureDimensions(tex, level));
  let at = clamp(vec2i(floor(texel_at_level(tex, texel, level))), vec2i(0), size - 1);
  return textureLoad(tex, at, layer, i32(level));
}

// Trilinear filtering at the level the footprint asks for.
fn texel_bilinear_mip(
  tex: texture_2d_array<f32>,
  linear: sampler,
  texel: vec2f,
  texel_footprint: vec2f,
  layer: i32,
  bias: f32,
) -> vec4f {
  let base = vec2f(textureDimensions(tex, 0u));
  let lod = texel_mip_lod(tex, texel_footprint, bias);
  return textureSampleLevel(tex, linear, texel / base, layer, lod);
}

// sampling.wgsl's sharp sampling on one level, with the footprint measured in that level's texels.
fn texel_sharp_level(
  tex: texture_2d_array<f32>,
  linear: sampler,
  texel: vec2f,
  texel_footprint: vec2f,
  layer: i32,
  level: u32,
) -> vec4f {
  let size = vec2f(textureDimensions(tex, level));
  let base = vec2f(textureDimensions(tex, 0u));
  let at = texel / base * size;
  let footprint = max(texel_footprint / base * size, vec2f(1e-4));
  let edge = floor(at + 0.5);
  let offset = clamp((at - edge) / footprint, vec2f(-0.5), vec2f(0.5));
  return textureSampleLevel(tex, linear, (edge + offset) / size, layer, f32(level));
}

// Sharp sampling on the two levels either side of the footprint, blended like trilinear. Where the
// art is magnified this is exactly sampling.wgsl's `sample_sharp`; where it is minified each level
// is sampled sharply at its own scale, so the coarse levels do the averaging and nothing aliases.
fn texel_sharp_mip(
  tex: texture_2d_array<f32>,
  linear: sampler,
  texel: vec2f,
  texel_footprint: vec2f,
  layer: i32,
  bias: f32,
) -> vec4f {
  let lod = texel_mip_lod(tex, texel_footprint, bias);
  let low = u32(floor(lod));
  let high = min(low + 1u, textureNumLevels(tex) - 1u);
  let a = texel_sharp_level(tex, linear, texel, texel_footprint, layer, low);
  let b = texel_sharp_level(tex, linear, texel, texel_footprint, layer, high);
  return mix(a, b, fract(lod));
}

fn texel_sample_mip(
  mode: u32,
  tex: texture_2d_array<f32>,
  linear: sampler,
  texel: vec2f,
  texel_footprint: vec2f,
  layer: i32,
  bias: f32,
) -> vec4f {
  if (mode == 0u) {
    return texel_nearest_mip(tex, texel, texel_footprint, layer, bias);
  }
  if (mode == 1u) {
    return texel_bilinear_mip(tex, linear, texel, texel_footprint, layer, bias);
  }
  return texel_sharp_mip(tex, linear, texel, texel_footprint, layer, bias);
}
