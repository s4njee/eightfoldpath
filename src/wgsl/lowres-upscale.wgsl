// lowres-upscale.wgsl -- the low-resolution path's last step (story 3.8): the virtual image drawn
// across the canvas, shifted by the camera's sub-pixel remainder.
//
// The virtual image was rendered with a camera snapped to whole virtual pixels, so the art in it
// never swims. The part of the camera's motion that snapping threw away (under half a virtual pixel
// each way) comes back here as an offset of the lookup, so the picture still glides smoothly; the
// virtual image carries a margin of a few pixels on every side so the shift never runs off its edge.
//
// Three filters: `nearest` (exact, but a non-integer scale makes virtual pixels one or two screen
// pixels wide, and the offset moves in whole screen pixels), `bilinear` (smooth, blurred), and
// `sharp` (sampling.wgsl's idea again: flat inside a virtual pixel, a one-screen-pixel blend across
// its edge, which keeps pixels square at any scale and lets the offset move by fractions).

#include "fullscreen.wgsl"

struct Upscale {
  // Canvas size in screen pixels.
  canvas: vec2f,
  // The virtual image's size, margin included, in virtual pixels.
  virtual_size: vec2f,
  // The sub-pixel remainder in virtual pixels, x right and y down the image.
  offset: vec2f,
  // Screen pixels per virtual pixel.
  scale: f32,
  // See MODE_*.
  mode: f32,
}

const MODE_NEAREST = 0.0;
const MODE_BILINEAR = 1.0;
const MODE_SHARP = 2.0;
// The inspector's raw view: the whole virtual image, margin and all, stretched over the canvas.
const MODE_RAW = 3.0;

@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var source_linear: sampler;
@group(0) @binding(2) var<uniform> upscale: Upscale;

// Where a screen position lands in the virtual image, in virtual pixels. Centre maps to centre, so
// whatever is left over when the canvas is not a whole number of virtual pixels is split evenly.
fn lowres_virtual_position(screen: vec2f) -> vec2f {
  return (screen - upscale.canvas * 0.5) / upscale.scale + upscale.virtual_size * 0.5
    + upscale.offset;
}

fn lowres_sharp(at: vec2f, footprint: f32) -> vec4f {
  let edge = floor(at + 0.5);
  let offset = clamp((at - edge) / max(footprint, 1e-4), vec2f(-0.5), vec2f(0.5));
  return textureSampleLevel(source, source_linear, (edge + offset) / upscale.virtual_size, 0.0);
}

@fragment fn fs(in: FullscreenVarying) -> @location(0) vec4f {
  if (upscale.mode == MODE_RAW) {
    let at = vec2i(in.uv * upscale.virtual_size);
    return textureLoad(source, clamp(at, vec2i(0), vec2i(upscale.virtual_size) - 1), 0);
  }
  let at = lowres_virtual_position(in.position.xy);
  if (upscale.mode == MODE_NEAREST) {
    return textureLoad(source, clamp(vec2i(floor(at)), vec2i(0), vec2i(upscale.virtual_size) - 1), 0);
  }
  if (upscale.mode == MODE_BILINEAR) {
    return textureSampleLevel(source, source_linear, at / upscale.virtual_size, 0.0);
  }
  return lowres_sharp(at, 1.0 / upscale.scale);
}
