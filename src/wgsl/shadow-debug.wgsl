// Shows a shadow map for the layer inspector (story 3.4): the depth texture as a square in the
// middle of the target, near the light white and far black, with a dark frame around it.

#include "fullscreen.wgsl"

@group(0) @binding(0) var map: texture_depth_2d;
@group(0) @binding(1) var<uniform> aspect: vec4f;

@fragment fn fs(in: FullscreenVarying) -> @location(0) vec4f {
  // Fit a square of 90% of the height, centred.
  let side = 0.9;
  let p = vec2f((in.uv.x - 0.5) * aspect.x, in.uv.y - 0.5) / side + 0.5;
  if (any(p < vec2f(0.0)) || any(p > vec2f(1.0))) {
    return vec4f(0.02, 0.02, 0.03, 1.0);
  }
  let size = vec2f(textureDimensions(map));
  let depth = textureLoad(map, vec2i(p * size), 0);
  // Cleared texels are 1: show them as mid grey so the casters stand out against them.
  if (depth >= 1.0) {
    return vec4f(0.25, 0.27, 0.32, 1.0);
  }
  return vec4f(vec3f(1.0 - depth), 1.0);
}
