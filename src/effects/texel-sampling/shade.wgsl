// texel-sampling's shade chunk for the sprite batcher (src/gpu/sprites/batch.wgsl).
//
// The batcher has already read the art with the column's sampling mode (`view.misc.y`), at level 0,
// and run the alpha test on it. With mipmaps on, this re-reads the colour from a mipmapped copy of
// the same texture array with the same mode (texel-mips.wgsl); alpha, and so the cut-out edge,
// stays level 0's. The inspector views draw what decides the level instead of the art.

#include "texel-mips.wgsl"

@group(2) @binding(0) var mip_art: texture_2d_array<f32>;
@group(2) @binding(1) var mip_linear: sampler;
// x: 1 to read colour from the mipmapped copy; y: inspector view, see VIEW_*; z: mip bias.
@group(2) @binding(2) var<uniform> sampling_options: vec4f;

const VIEW_FOOTPRINT = 1u;
const VIEW_LEVEL = 2u;

fn sprite_shade(f: SpriteFragment) -> vec3f {
  let inspect = u32(sampling_options.y);
  if (inspect == VIEW_FOOTPRINT) {
    // Texels per screen pixel on a log scale: blue where the art is magnified (several pixels per
    // texel), white at one to one, red where it is minified and nearest sampling must skip texels.
    let scale = log2(max(max(f.texel_footprint.x, f.texel_footprint.y), 1e-6));
    let t = clamp(scale / 3.0, -1.0, 1.0);
    return select(mix(vec3f(1.0), vec3f(0.05, 0.2, 1.0), -t), mix(vec3f(1.0), vec3f(1.0, 0.1, 0.05), t), t > 0.0);
  }
  if (inspect == VIEW_LEVEL) {
    // The mip level texel-mips.wgsl would read, a step of grey per level.
    let level = texel_mip_lod(mip_art, f.texel_footprint, sampling_options.z);
    return vec3f(level / f32(textureNumLevels(mip_art) - 1u));
  }
  if (sampling_options.x < 0.5) {
    return f.color.rgb;
  }
  let mode = u32(view.misc.y);
  let bias = sampling_options.z;
  return texel_sample_mip(mode, mip_art, mip_linear, f.texel, f.texel_footprint, f.layer, bias).rgb;
}
