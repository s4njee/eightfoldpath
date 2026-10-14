// sampling.wgsl -- three ways to read pixel art from a texture array (story 3.1).
//
// Coordinates are in texels of the layer (0..width, 0..height), not 0..1 UVs, because pixel art is
// reasoned about in texels. `texel_footprint` must be the screen-space size of one pixel in texels,
// `fwidth(texel)`, taken by the caller in uniform control flow (derivatives are not allowed after a
// branch on a varying), so these functions can be called anywhere.
//
//   nearest   one texel, exactly: crisp, but texels shimmer and crawl when the camera moves,
//             because which texel a pixel lands on flips from frame to frame.
//   bilinear  hardware filtering: smooth motion, but every texel edge is blurred across a full
//             texel, so pixel art goes soft as soon as it is magnified.
//   sharp     bilinear sampling of UVs pushed toward texel centres: inside a texel the colour is
//             flat, and across an edge it blends over one screen pixel. Square texels, antialiased
//             edges, stable under motion. The cost is one sample and a few ALU ops.

const SAMPLING_NEAREST = 0u;
const SAMPLING_BILINEAR = 1u;
const SAMPLING_SHARP = 2u;

fn sample_nearest(tex: texture_2d_array<f32>, texel: vec2f, layer: i32) -> vec4f {
  let size = vec2i(textureDimensions(tex));
  let at = clamp(vec2i(floor(texel)), vec2i(0), size - 1);
  return textureLoad(tex, at, layer, 0);
}

fn sample_bilinear(tex: texture_2d_array<f32>, linear: sampler, texel: vec2f, layer: i32) -> vec4f {
  let size = vec2f(textureDimensions(tex));
  return textureSampleLevel(tex, linear, texel / size, layer, 0.0);
}

// The widely used "sharp bilinear" idea (sources in src/effects/texel-sampling/notes.md): keep the
// fractional position pinned to the texel centre except within half a screen pixel of a texel
// edge, where it ramps linearly across the edge so the hardware filter produces a one-pixel blend.
fn sample_sharp(
  tex: texture_2d_array<f32>,
  linear: sampler,
  texel: vec2f,
  texel_footprint: vec2f,
  layer: i32,
) -> vec4f {
  let size = vec2f(textureDimensions(tex));
  let edge = floor(texel + 0.5);
  let footprint = max(texel_footprint, vec2f(1e-4));
  let offset = clamp((texel - edge) / footprint, vec2f(-0.5), vec2f(0.5));
  return textureSampleLevel(tex, linear, (edge + offset) / size, layer, 0.0);
}

fn sample_pixel_art(
  mode: u32,
  tex: texture_2d_array<f32>,
  linear: sampler,
  texel: vec2f,
  texel_footprint: vec2f,
  layer: i32,
) -> vec4f {
  if (mode == SAMPLING_NEAREST) {
    return sample_nearest(tex, texel, layer);
  }
  if (mode == SAMPLING_BILINEAR) {
    return sample_bilinear(tex, linear, texel, layer);
  }
  return sample_sharp(tex, linear, texel, texel_footprint, layer);
}
