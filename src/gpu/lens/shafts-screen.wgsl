// Screen-space light shafts (Mitchell, GPU Gems 3 ch. 13): every pixel averages the occlusion mask
// along the line from itself toward the light, with weights that decay along the way. Lit sky seen
// past an occluder smears outward from the light into rays; occluders smear into shadow between them.
//
// fs_radial is run twice. The first run takes `taps` samples over the first 1/taps of the ray,
// the second `taps` samples of that result spread over the whole ray, so together they cover the
// ray with taps² evenly spaced samples (and taps² decay steps) for 2 × taps fetches a pixel.

#include "fullscreen.wgsl"
#include "shaft_params.wgsl"

@group(0) @binding(0) var<uniform> params: ShaftParams;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

@fragment fn fs_radial(in: FullscreenVarying) -> @location(0) vec4f {
  let taps = i32(params.taps);
  let step = (params.sun - in.uv) * params.reach / params.taps;
  var uv = in.uv;
  var sum = vec3f(0.0);
  var weight = 1.0;
  var total = 0.0;
  for (var i = 0; i < taps; i++) {
    sum += textureSampleLevel(src, samp, uv, 0.0).rgb * weight;
    total += weight;
    weight *= params.decay;
    uv += step;
  }
  return vec4f(sum / total, 1.0);
}

// Added to the scene with one-one blending (alpha untouched), or drawn alone over a cleared target.
@fragment fn fs_composite(in: FullscreenVarying) -> @location(0) vec4f {
  return vec4f(textureSampleLevel(src, samp, in.uv, 0.0).rgb * params.gain, 0.0);
}
