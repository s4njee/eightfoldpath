// Palette cycling (story 3.6): one fullscreen pass. Each pixel finds which texel of which image it
// covers (whole-number scales, so no resampling), loads that texel's palette index, rotates it
// inside the image's cycling range, and loads the colour from the image's palette row. Under each
// image a strip shows its palette as it rotates, with the cycling range underlined.

#include "fullscreen.wgsl"
#include "palette.wgsl"
#include "params.wgsl"

@group(0) @binding(0) var<uniform> params: Params;
// One layer per image, one palette index per texel; 255 is transparent.
@group(0) @binding(1) var indices: texture_2d_array<u32>;
// One row per image: its own small palette, cycling ranges first.
@group(0) @binding(2) var palettes: texture_2d<f32>;

const TRANSPARENT = 255u;
const VIEW_INDICES = 1.0;
const VIEW_RANGES = 2.0;

struct Image {
  // Top-left in pixels, pixels per texel, texture layer.
  origin: vec2f,
  scale: f32,
  layer: u32,
  size: vec2u,
  // Palette row and colour count.
  row: u32,
  count: u32,
  start: u32,
  length: u32,
  // Rotation in steps (fractional part used by `blend`), and steps of extra lag per texel row.
  phase: f32,
  row_lag: f32,
  // The palette strip: top-left and swatch size, in pixels.
  strip: vec3f,
}

fn image(i: u32) -> Image {
  let a = params.images[i * 4u];
  let b = params.images[i * 4u + 1u];
  let c = params.images[i * 4u + 2u];
  let d = params.images[i * 4u + 3u];
  return Image(a.xy, a.z, u32(a.w), vec2u(b.xy), u32(b.z), u32(b.w), u32(c.x), u32(c.y), c.z, c.w, d.xyz);
}

fn colour_at(row: u32, index: u32) -> vec3f {
  return textureLoad(palettes, vec2u(index, row), 0).rgb;
}

/** The colour an index shows after rotating by `phase` steps, blended between steps if asked. */
fn cycled(img: Image, index: u32, phase: f32) -> vec3f {
  let step = floor(phase);
  let now = colour_at(img.row, palette_cycle_index(index, img.start, img.length, i32(step)));
  if (params.blend < 0.5) {
    return now;
  }
  let next = colour_at(img.row, palette_cycle_index(index, img.start, img.length, i32(step) + 1));
  return mix(now, next, phase - step);
}

fn in_range(img: Image, index: u32) -> bool {
  return index >= img.start && index < img.start + img.length;
}

fn debug_colour(img: Image, index: u32, colour: vec3f) -> vec3f {
  if (params.view == VIEW_INDICES) {
    return vec3f(srgb_to_linear_f((f32(index) + 1.0) / f32(img.count + 1u)));
  }
  // VIEW_RANGES: the cycling texels by their place in the range, everything else dimmed.
  if (in_range(img, index)) {
    let t = (f32(index - img.start) + 1.0) / f32(img.length);
    return mix(vec3f(0.02, 0.0, 0.05), vec3f(1.0, 0.25, 0.85), t);
  }
  return vec3f(luminance(colour) * 0.2);
}

@fragment fn fs(in: FullscreenVarying) -> @location(0) vec4f {
  let pixel = in.position.xy;
  for (var i = 0u; i < 2u; i++) {
    let img = image(i);
    let local = floor((pixel - img.origin) / img.scale);
    if (all(local >= vec2f(0.0)) && all(local < vec2f(img.size))) {
      let texel = vec2u(local);
      let index = textureLoad(indices, texel, img.layer, 0).r;
      if (index == TRANSPARENT) {
        break;
      }
      // Rows further down lag behind, so bands travel down the image instead of flickering in
      // place (only where the art's bands run across the flow; see notes.md).
      let colour = cycled(img, index, img.phase - f32(texel.y) * img.row_lag);
      if (params.view > 0.5) {
        return vec4f(debug_colour(img, index, colour), 1.0);
      }
      return vec4f(colour, 1.0);
    }

    // The palette strip: one swatch per entry, shown as it currently maps, range underlined.
    let swatch = img.strip.z;
    let cell = floor((pixel - img.strip.xy) / swatch);
    if (cell.x >= 0.0 && cell.x < f32(img.count) && cell.y >= 0.0 && cell.y < 1.0) {
      let index = u32(cell.x);
      let colour = cycled(img, index, img.phase);
      if (params.view > 0.5) {
        return vec4f(debug_colour(img, index, colour), 1.0);
      }
      return vec4f(colour, 1.0);
    }
    let unit = swatch / 5.0;
    let under = pixel.y - (img.strip.y + swatch + unit);
    if (cell.x >= 0.0 && cell.x < f32(img.count) && under >= 0.0 && under < unit &&
        in_range(img, u32(cell.x))) {
      return vec4f(params.marker, 1.0);
    }
  }
  return vec4f(params.background, 1.0);
}
