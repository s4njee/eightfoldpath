// Depth of field for one flat layer of pixel art (story 9.4): a separable Gaussian computed once,
// written at `supersample` times the art's resolution.
//
// The source is pixel art, i.e. square blocks of constant colour. Blurring the blocks rather than
// point samples means each source texel's weight is the Gaussian's integral over its extent,
// Phi((r + 1 - x) / sigma) - Phi((r - x) / sigma), so a pass loops over source texels (about
// 6 sigma of them) however finely the output is sampled, and a sigma near zero gives back the
// blocks exactly. Colour is premultiplied before it is blurred, so transparent texels (stored as
// black) cannot darken an edge.

#include "fullscreen.wgsl"
#include "layer_dof_params.wgsl"

@group(0) @binding(0) var<uniform> params: LayerDofParams;
// fs_h reads the art (sRGB, straight alpha); fs_v reads fs_h's output (linear, premultiplied).
@group(0) @binding(1) var art: texture_2d_array<f32>;
@group(0) @binding(2) var rows: texture_2d<f32>;

// Abramowitz and Stegun 7.1.26: |error| < 1.5e-7, plenty for weights stored in eight bits.
fn erf_approx(x: f32) -> f32 {
  let a = abs(x);
  let t = 1.0 / (1.0 + 0.3275911 * a);
  let poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return sign(x) * (1.0 - poly * exp(-a * a));
}

// The Gaussian's share of the texel spanning [r, r + 1] for an output centred at x.
fn texel_weight(r: i32, x: f32) -> f32 {
  let k = 1.0 / (max(params.sigma, 1e-3) * 1.41421356);
  return 0.5 * (erf_approx((f32(r) + 1.0 - x) * k) - erf_approx((f32(r) - x) * k));
}

fn wrap_or_clamp(r: i32, n: i32, wrap: bool) -> i32 {
  if (wrap) {
    return ((r % n) + n) % n;
  }
  return clamp(r, 0, n - 1);
}

// Horizontal: output is `supersample` times wider than the art, one row per art row.
@fragment fn fs_h(in: FullscreenVarying) -> @location(0) vec4f {
  let size = vec2i(params.size);
  let x = in.position.x / params.supersample;
  let row = i32(in.position.y);
  let centre = i32(floor(x));
  let taps = i32(params.taps);
  var sum = vec4f(0.0);
  var total = 0.0;
  for (var i = -taps; i <= taps; i++) {
    let r = centre + i;
    let w = texel_weight(r, x);
    let c = textureLoad(art, vec2i(wrap_or_clamp(r, size.x, params.wrap_x > 0.5), row), 0, 0);
    sum += vec4f(c.rgb * c.a, c.a) * w;
    total += w;
  }
  return sum / max(total, 1e-6);
}

// Vertical: output is `supersample` times the art's size; the edges clamp, as the sampler does.
@fragment fn fs_v(in: FullscreenVarying) -> @location(0) vec4f {
  let size = vec2i(params.size);
  let y = in.position.y / params.supersample;
  let column = i32(in.position.x);
  let centre = i32(floor(y));
  let taps = i32(params.taps);
  var sum = vec4f(0.0);
  var total = 0.0;
  for (var i = -taps; i <= taps; i++) {
    let r = centre + i;
    let w = texel_weight(r, y);
    sum += textureLoad(rows, vec2i(column, clamp(r, 0, size.y - 1)), 0) * w;
    total += w;
  }
  return sum / max(total, 1e-6);
}
