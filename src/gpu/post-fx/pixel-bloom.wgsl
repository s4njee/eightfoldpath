// The bloom source for pixel art (story 5.4): threshold every scene texel on its own, then average
// 2 x 2 of them into a half-size image that the bloom chain takes as it is.
//
// The stock chain thresholds after it has averaged: its first downsample takes five overlapping
// 4-tap boxes and only then applies the knee to each box's mean. A lamp's glass a few texels across
// is mixed with the dark frame around it before the threshold sees it, so a threshold high enough
// to leave the lit scene alone also starves the lamp, and lowering it to rescue the lamp lifts the
// lit scene too. Thresholding first keeps a hot texel's whole excess whatever surrounds it.

#include "fullscreen.wgsl"
#include "pixel-bloom-params.wgsl"

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> params: PixelBloomParams;

// The stock chain's soft knee (Unity's), on the brightest channel, hue kept by scaling the colour.
fn pixel_bloom_keep(colour: vec3f) -> vec3f {
  let c = clamp(colour, vec3f(0.0), vec3f(65000.0));
  let brightness = max(c.r, max(c.g, c.b));
  let knee = max(params.knee, 1e-5);
  let soft = clamp(brightness - params.threshold + knee, 0.0, 2.0 * knee);
  let curve = soft * soft / (4.0 * knee);
  return c * (max(curve, brightness - params.threshold) / max(brightness, 1e-5));
}

@fragment fn fs(in: FullscreenVarying) -> @location(0) vec4f {
  // Each output texel covers the 2 x 2 source texels under it (the last row or column of an odd
  // size repeats its edge).
  let size = vec2i(textureDimensions(src));
  let base = vec2i(floor(in.uv * vec2f(size) - vec2f(0.5)));
  var sum = vec3f(0.0);
  for (var i = 0; i < 4; i++) {
    let p = clamp(base + vec2i(i & 1, i >> 1), vec2i(0), size - 1);
    sum += pixel_bloom_keep(textureLoad(src, p, 0).rgb);
  }
  return vec4f(sum * 0.25, 1.0);
}

// The source alone, at full size, for the inspector: what is allowed to glow.
@fragment fn fs_view(in: FullscreenVarying) -> @location(0) vec4f {
  return vec4f(pixel_bloom_keep(textureLoad(src, vec2i(in.position.xy), 0).rgb), 1.0);
}
