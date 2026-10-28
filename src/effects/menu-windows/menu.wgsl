// Menu windows (story 9.6): the scene with frosted glass where the windows are, in one pass.
//
// Outside the windows: the diorama's still, tonemapped. Inside them: the blurred copy (made at a
// fraction of the size, so it is bilinearly enlarged here for nothing), tonemapped, tinted
// towards the window colour, and then scaled down wherever it is brighter than `ceiling`, the
// luminance that keeps the menu's light text at its contrast ratio over any part of the scene.
// Just below and right of each window the scene is darkened, a drop shadow two texels deep.
// The frames and the cursor are drawn after this by the pixel-quad renderer, over the result.

#include "fullscreen.wgsl"
#include "color.wgsl"
#include "params.wgsl"

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var still: texture_2d<f32>;
@group(0) @binding(2) var blurred: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;

const VIEW_FINAL = 0.0;
const VIEW_STILL = 1.0;
const VIEW_BLURRED = 2.0;

fn inside(p: vec2f, r: vec4f) -> bool {
  return all(p >= r.xy) && all(p < r.xy + r.zw);
}

fn glass(sharp: vec3f, uv: vec2f) -> vec3f {
  let behind = select(sharp, textureSampleLevel(blurred, samp, uv, 0.0).rgb, params.blur_on > 0.5);
  var c = mix(tonemap_aces(behind * params.exposure), params.tint, params.tint_amount);
  let l = luminance(c);
  if (l > params.ceiling) {
    c *= params.ceiling / l;
  }
  return c;
}

@fragment fn fs(in: FullscreenVarying) -> @location(0) vec4f {
  let sharp = textureSampleLevel(still, samp, in.uv, 0.0).rgb;
  if (params.view == VIEW_STILL) {
    return vec4f(tonemap_aces(sharp * params.exposure), 1.0);
  }
  if (params.view == VIEW_BLURRED) {
    return vec4f(tonemap_aces(textureSampleLevel(blurred, samp, in.uv, 0.0).rgb * params.exposure), 1.0);
  }

  // Whole texels, so the glass and the shadow end on the same grid as the frame.
  let p = floor(in.position.xy / params.scale);
  var shade = 1.0;
  for (var i = 0u; i < u32(params.count); i++) {
    let r = params.rects[i];
    // Two texels in from the outline, so the frame's rounded corners keep the scene behind them.
    if (inside(p, vec4f(r.xy + 2.0, r.zw - 4.0))) {
      return vec4f(glass(sharp, in.uv), 1.0);
    }
    if (params.shadow > 0.0 && inside(p, vec4f(r.xy + 2.0, r.zw)) && !inside(p, r)) {
      shade = 1.0 - params.shadow;
    }
  }
  return vec4f(tonemap_aces(sharp * params.exposure) * shade, 1.0);
}
