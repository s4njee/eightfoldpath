// palette.wgsl -- palette mapping (story 3.5): nearest palette colour through a 3D lookup table,
// ordered and blue-noise dither thresholds, shading ramps, and an exact search to check the table
// against. The tables are built on the CPU by src/gpu/palette/ (createPaletteLutTexture etc.).
//
// OKLab (B. Ottosson, 2020), for measuring colour differences
//   linear_to_oklab(c: vec3f) -> vec3f          linear Rec.709 RGB -> OKLab (L 0..1)
//
// Lookup table: a 3D rgba8unorm-srgb texture, N^3 cells evenly spaced in sRGB-ENCODED values; each
// cell holds the palette colour nearest (in OKLab) to the cell's centre, with its index / 255 in
// alpha. textureLoad of an -srgb texture returns linear light, so the result is ready to light or
// write to a linear target.
//   palette_lut_cell(lut, srgb: vec3f) -> vec3u          the cell an sRGB-encoded colour rounds to
//   palette_lut_lookup(lut, linear: vec3f) -> vec4f      nearest palette colour (linear rgb, index/255)
//   palette_lut_lookup_srgb(lut, srgb: vec3f) -> vec4f   the same for an sRGB-encoded colour (dithered)
//
// Exact search, for checking the table: every entry of a count x 1 rgba8unorm-srgb palette texture.
//   palette_nearest_exact(palette, linear: vec3f) -> vec4f   (linear rgb, index / 255)
//
// Dither: a threshold in (0, 1) per pixel, spread evenly, added around the colour before the lookup
// so a colour between two palette entries comes out as a mix of both.
//   palette_bayer8(pixel: vec2u) -> f32                  Bayer's 8x8 ordered matrix, (rank + 0.5) / 64
//   palette_blue_noise(tex, pixel: vec2u) -> f32         an r8unorm blue-noise tile, wrapped
//   palette_dither_srgb(srgb, threshold, strength) -> vec3f   srgb + (threshold - 0.5) * strength
//
// Ramps: rows of an rgba8unorm-srgb texture, dark to light (createRampTexture).
//   palette_ramp(ramps, row: u32, level: f32) -> vec3f   level 0..1 quantised to a step of the row
//
// Cycling (story 3.6): a run of palette entries [start, start + length) rotated by `shift` steps;
// indices outside the run are returned unchanged. Positive shifts move each colour to the next
// index up. The CPU twin is cycleIndex in src/gpu/palette/indexed.ts.
//   palette_cycle_index(index: u32, start: u32, length: u32, shift: i32) -> u32
//
// Cost: a lookup is one linear_to_srgb (3 pow) and one textureLoad. The exact search is 3 cube roots
// and a textureLoad per palette entry: 48 entries is a few hundred ALU ops per pixel.

#include "color.wgsl"

fn palette_cbrt(x: vec3f) -> vec3f {
  return sign(x) * pow(abs(x), vec3f(1.0 / 3.0));
}

fn linear_to_oklab(c: vec3f) -> vec3f {
  let lms = palette_cbrt(vec3f(
    0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b,
    0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b,
    0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b,
  ));
  return vec3f(
    0.2104542553 * lms.x + 0.7936177850 * lms.y - 0.0040720468 * lms.z,
    1.9779984951 * lms.x - 2.4285922050 * lms.y + 0.4505937099 * lms.z,
    0.0259040371 * lms.x + 0.7827717662 * lms.y - 0.8086757660 * lms.z,
  );
}

fn palette_lut_cell(lut: texture_3d<f32>, srgb: vec3f) -> vec3u {
  let last = f32(textureDimensions(lut).x - 1u);
  return vec3u(round(clamp(srgb, vec3f(0.0), vec3f(1.0)) * last));
}

fn palette_lut_lookup_srgb(lut: texture_3d<f32>, srgb: vec3f) -> vec4f {
  return textureLoad(lut, palette_lut_cell(lut, srgb), 0);
}

fn palette_lut_lookup(lut: texture_3d<f32>, linear: vec3f) -> vec4f {
  return palette_lut_lookup_srgb(lut, linear_to_srgb(linear));
}

fn palette_nearest_exact(palette: texture_2d<f32>, linear: vec3f) -> vec4f {
  let target_lab = linear_to_oklab(max(linear, vec3f(0.0)));
  let count = textureDimensions(palette).x;
  var best = vec4f(0.0);
  var best_distance = 1e9;
  for (var i = 0u; i < count; i++) {
    let colour = textureLoad(palette, vec2u(i, 0u), 0).rgb;
    let delta = linear_to_oklab(colour) - target_lab;
    let d = dot(delta, delta);
    if (d < best_distance) {
      best_distance = d;
      best = vec4f(colour, f32(i) / 255.0);
    }
  }
  return best;
}

// Rank of (x, y) in the recursive Bayer matrix M(2n) = [[4M, 4M+2], [4M+3, 4M+1]]: each bit level
// of the coordinates picks a quadrant worth 2 * (x ^ y) + y, and the finest level is the most
// significant, which is what spreads consecutive ranks as far apart as possible.
fn palette_bayer8(pixel: vec2u) -> f32 {
  var rank = 0u;
  for (var level = 0u; level < 3u; level++) {
    let x = (pixel.x >> level) & 1u;
    let y = (pixel.y >> level) & 1u;
    rank |= (2u * (x ^ y) + y) << (2u * (2u - level));
  }
  return (f32(rank) + 0.5) / 64.0;
}

fn palette_blue_noise(tex: texture_2d<f32>, pixel: vec2u) -> f32 {
  let size = textureDimensions(tex);
  let value = textureLoad(tex, pixel % size, 0).r;
  return (round(value * 255.0) + 0.5) / 256.0;
}

fn palette_dither_srgb(srgb: vec3f, threshold: f32, strength: f32) -> vec3f {
  return srgb + vec3f((threshold - 0.5) * strength);
}

fn palette_ramp(ramps: texture_2d<f32>, row: u32, level: f32) -> vec3f {
  let steps = textureDimensions(ramps).x;
  let column = min(u32(max(level, 0.0) * f32(steps)), steps - 1u);
  return textureLoad(ramps, vec2u(column, row), 0).rgb;
}

fn palette_cycle_index(index: u32, start: u32, length: u32, shift: i32) -> u32 {
  if (index < start || index >= start + length || length == 0u) {
    return index;
  }
  let n = i32(length);
  let offset = ((i32(index - start) - shift) % n + n) % n;
  return start + u32(offset);
}
