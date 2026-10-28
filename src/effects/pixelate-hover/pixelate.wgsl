// Pixelate hover (story 9.3): one fullscreen pass that shows a picture either in full detail or as
// palette-mapped blocks, whichever step of the hover transition this frame is on.
//
// Blocks live in the picture's texels, anchored at its centre, not on the screen: each pixel finds
// the block of the picture it lands in, reads that block's average colour from the mip chain at
// the block's centre (one trilinear sample at the level with about one texel per block), adds the
// block's dither threshold and looks up the nearest palette colour (story 3.5's table). Every pixel
// of a block does the same sums, so a block is one flat colour without a second pass or a
// low-resolution target.

#include "fullscreen.wgsl"
#include "palette.wgsl"
#include "params.wgsl"

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var picture: texture_2d<f32>;
@group(0) @binding(2) var picture_sampler: sampler;
@group(0) @binding(3) var lut: texture_3d<f32>;
@group(0) @binding(4) var blue_noise: texture_2d<f32>;

const VIEW_BLOCKS = 1.0;
const VIEW_ERROR = 2.0;
const VIEW_THRESHOLD = 3.0;
// Added to block indices so they are never negative. A multiple of 64, so neither the 8 × 8 Bayer
// matrix nor the 64 × 64 blue-noise tile shifts against the picture.
const INDEX_OFFSET = 4096;

fn threshold(block: vec2u) -> f32 {
  if (params.dither > 1.5) {
    return palette_blue_noise(blue_noise, block);
  }
  if (params.dither > 0.5) {
    return palette_bayer8(block);
  }
  return 0.5;
}

// Black, red, yellow, white: how far each block moved to reach the palette.
fn heat(t: f32) -> vec3f {
  let x = clamp(t, 0.0, 1.0) * 3.0;
  return clamp(vec3f(x, x - 1.0, x - 2.0), vec3f(0.0), vec3f(1.0));
}

@fragment fn fs(in: FullscreenVarying) -> @location(0) vec4f {
  let size = params.picture_size;
  // The picture's texel under this pixel: it covers the canvas about its centre, zoomed by hover.
  let texel = size * 0.5 + (in.position.xy - params.centre) / params.scale;

  if (params.block <= 0.0) {
    return vec4f(textureSampleLevel(picture, picture_sampler, texel / size, params.detail_lod).rgb, 1.0);
  }

  let cell = floor((texel - size * 0.5) / params.block);
  let middle = (cell + 0.5) * params.block + size * 0.5;
  let source = textureSampleLevel(picture, picture_sampler, middle / size, params.block_lod).rgb;
  let index = vec2u(vec2i(cell) + vec2i(INDEX_OFFSET));
  let t = threshold(index);
  if (params.view == VIEW_THRESHOLD) {
    return vec4f(vec3f(srgb_to_linear_f(t)), 1.0);
  }

  var mapped = source;
  if (params.mapping > 0.5) {
    mapped = palette_lut_lookup_srgb(lut, palette_dither_srgb(linear_to_srgb(source), t, params.strength)).rgb;
  }
  if (params.view == VIEW_ERROR) {
    let error = length(linear_to_oklab(mapped) - linear_to_oklab(max(source, vec3f(0.0))));
    return vec4f(srgb_to_linear(heat(error * params.error_gain)), 1.0);
  }
  if (params.view == VIEW_BLOCKS) {
    // Every other block dimmed, a checkerboard that shows the grid and where it is anchored.
    let odd = ((index.x + index.y) & 1u) == 1u;
    return vec4f(select(mapped, mapped * 0.35, odd), 1.0);
  }
  return vec4f(mapped, 1.0);
}
