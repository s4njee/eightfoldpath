// Grade and finishing (stories 5.7 and 5.8): the last pass before the canvas.
//
// It reads the output pass's picture: tonemapped, sRGB-encoded, display-referred (values above 1
// only on an HDR canvas), alpha as the output pass wrote it. Then, in this order:
//
//   1. grade        a 3D lookup table, or two crossfading, on the encoded colour (grade.ts says why)
//   2. aberration   red and blue taken a little further out and further in than green, growing
//                   with the square of the distance from the centre, so the middle stays clean
//   3. vignette     the corners darkened in linear light, flat across the middle
//   4. grain        zero-mean noise, new every frame, strongest in the mid-tones
//   5. dither       the same triangular dither the output pass would have added (it was told not to)
//
// Each part is a uniform branch: with its amount at 0 it costs nothing but the test.

#include "fullscreen.wgsl"
#include "color.wgsl"
#include "hash.wgsl"
#include "finish-params.wgsl"

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var lut_from: texture_3d<f32>;
@group(0) @binding(3) var lut_to: texture_3d<f32>;
@group(0) @binding(4) var<uniform> finish: FinishParams;

const VIEW_FINAL = 0u;
const VIEW_VIGNETTE = 1u;
const VIEW_GRAIN = 2u;
const VIEW_ABERRATION = 3u;
const VIEW_TABLE = 4u;

// A colour through the table(s): cells are spaced evenly over 0..1, so (n - 1) / n scales the
// colour onto the cell centres. Anything above 1 (an HDR canvas) is graded as 1 and the excess
// carried over unchanged, so highlights keep their headroom.
fn finish_lut(c: vec3f) -> vec3f {
  let clamped = clamp(c, vec3f(0.0), vec3f(1.0));
  let n = finish.lut_size;
  let uvw = clamped * ((n - 1.0) / n) + vec3f(0.5 / n);
  // One table when nothing is fading, two while it is.
  var graded = textureSampleLevel(lut_to, samp, uvw, 0.0).rgb;
  if (finish.grade_mix < 1.0) {
    graded = mix(textureSampleLevel(lut_from, samp, uvw, 0.0).rgb, graded, finish.grade_mix);
  }
  return mix(clamped, graded, finish.grade_strength) + max(c - vec3f(1.0), vec3f(0.0));
}

// Premultiplied colour is graded as the colour it stands for, then multiplied back.
fn finish_grade(texel: vec4f) -> vec4f {
  if (finish.grade_on == 0.0) { return texel; }
  if (finish.opaque == 1.0) { return vec4f(finish_lut(texel.rgb), texel.a); }
  if (texel.a <= 1e-4) { return texel; }
  return vec4f(finish_lut(texel.rgb / texel.a) * texel.a, texel.a);
}

fn finish_tap(uv: vec2f) -> vec4f {
  return finish_grade(textureSampleLevel(src, samp, uv, 0.0));
}

// Distance from the centre: 0 there, 1 at the corners, measured in pixels so it is round.
fn finish_radius(uv: vec2f) -> f32 {
  let d = (uv - 0.5) * vec2f(finish.aspect, 1.0);
  return length(d) / length(vec2f(finish.aspect, 1.0) * 0.5);
}

fn finish_vignette(uv: vec2f) -> f32 {
  let r = finish_radius(uv);
  return 1.0 - finish.vignette * smoothstep(finish.vignette_radius, finish.vignette_radius + finish.vignette_softness, r);
}

// Value noise over cells `grain_size` pixels wide, re-seeded every frame: two hashes summed, so
// each cell is triangular noise in [-1, 1] with mean 0, smoothly interpolated between cells.
fn finish_grain_cell(cell: vec2i, seed: i32) -> f32 {
  let h = ihash_2to2(cell + vec2i(seed, seed * 3));
  return h.x + h.y - 1.0;
}

fn finish_grain_noise(pixel: vec2f) -> f32 {
  let p = pixel / max(finish.grain_size, 1.0);
  let cell = vec2i(floor(p));
  let f = smoothstep(vec2f(0.0), vec2f(1.0), fract(p));
  let seed = i32(finish.frame) * 7919;
  let a = finish_grain_cell(cell, seed);
  let b = finish_grain_cell(cell + vec2i(1, 0), seed);
  let c = finish_grain_cell(cell + vec2i(0, 1), seed);
  let d = finish_grain_cell(cell + vec2i(1, 1), seed);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Film grain is most visible in the mid-tones and vanishes in black and in white.
fn finish_grain_weight(encoded: vec3f) -> f32 {
  let y = clamp(dot(encoded, vec3f(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  return 4.0 * y * (1.0 - y);
}

fn finish_dither(pixel: vec2f) -> f32 {
  let shift = vec2f(5.588238 * (finish.frame % 64.0));
  let a = fract(52.9829189 * fract(dot(pixel + shift, vec2f(0.06711056, 0.00583715))));
  let b = fract(52.9829189 * fract(dot(pixel.yx + vec2f(37.0, 91.0) + shift, vec2f(0.06711056, 0.00583715))));
  return a + b - 1.0;
}

// The table itself, for the inspector: its 32 blue slices side by side in an 8 x 4 grid, each a
// red (across) by green (down) square.
fn finish_table(uv: vec2f) -> vec3f {
  let grid = vec2f(8.0, 4.0);
  let tile = floor(uv * grid);
  let local = fract(uv * grid);
  let blue = (tile.y * grid.x + tile.x) / (grid.x * grid.y - 1.0);
  return finish_lut(vec3f(local.x, 1.0 - local.y, blue));
}

@fragment fn fs(in: FullscreenVarying) -> @location(0) vec4f {
  let uv = in.uv;
  if (finish.view == VIEW_TABLE) { return vec4f(finish_table(uv), 1.0); }

  var texel = finish_tap(uv);
  let r = finish_radius(uv);
  if (finish.aberration > 0.0) {
    // Along the radius, `aberration` pixels at the corners and the square of the radius inside.
    let pixels = max(length((uv - 0.5) * finish.resolution), 1e-3);
    let shift = (uv - 0.5) * (r * r * finish.aberration / pixels);
    let red = finish_tap(uv + shift);
    let blue = finish_tap(uv - shift);
    if (finish.view == VIEW_ABERRATION) {
      return vec4f(abs(vec3f(red.r, 0.0, blue.b) - vec3f(texel.r, 0.0, texel.b)) * 8.0, 1.0);
    }
    texel = vec4f(red.r, texel.g, blue.b, max(texel.a, max(red.a, blue.a)));
  } else if (finish.view == VIEW_ABERRATION) {
    return vec4f(0.0, 0.0, 0.0, 1.0);
  }

  var rgb = texel.rgb;
  if (finish.vignette > 0.0 || finish.view == VIEW_VIGNETTE) {
    let v = finish_vignette(uv);
    if (finish.view == VIEW_VIGNETTE) { return vec4f(vec3f(v), 1.0); }
    rgb = linear_to_srgb(srgb_to_linear(rgb) * v);
  }

  var noise = 0.0;
  if (finish.grain > 0.0 || finish.view == VIEW_GRAIN) {
    let n = finish_grain_noise(in.position.xy);
    if (finish.view == VIEW_GRAIN) { return vec4f(vec3f(0.5 + n * 0.5), 1.0); }
    noise = n * finish.grain * finish_grain_weight(rgb);
  }
  noise += finish_dither(in.position.xy) * finish.dither_lsb;

  if (finish.opaque == 1.0) { return vec4f(max(rgb + vec3f(noise), vec3f(0.0)), 1.0); }
  // See-through: no grain or dither where nothing is drawn, and never a colour above its alpha.
  let peak = max(rgb.r, max(rgb.g, rgb.b));
  let out = max(rgb + vec3f(noise * smoothstep(0.0, 2.0 / 255.0, peak)), vec3f(0.0));
  return vec4f(min(out, vec3f(max(texel.a, 0.0))), texel.a);
}
