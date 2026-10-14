// A fixture for the shader plugin tests: a fragment shader that reaches into the shared library
// (fbm.wgsl includes noise.wgsl, so one include pulls in two files) and a run-time chunk.
#include "fullscreen.wgsl"
#include "fbm.wgsl"
#include "params.wgsl"

@group(0) @binding(0) var<uniform> params: Params;

@fragment fn fs(in: FullscreenVarying) -> @location(0) vec4f {
  return vec4f(vec3f(fbm_2d(in.uv * params.scale, 4, 2.0, 0.5)), 1.0);
}
