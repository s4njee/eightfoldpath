// Dialogue box (story 9.5): the light around the window, drawn after the backdrop and before the
// frame, in the same render pass.
//
// Two things, both evaluated once per texel (at the texel's centre) and quantised into a few
// bands, so they fall on the pixel grid in steps the way the art's own shading does (story 3.3):
//
//   - a scrim that darkens the scene from a little above the window down to the bottom edge, so
//     the window reads against any backdrop and, over a page, dims the page behind it;
//   - a warm halo just outside the frame, breathing slowly, the lantern-lit window of the genre.
//
// The output is premultiplied: colour added on top, alpha how much of what is behind is hidden.
// The pipeline blends `src + dst * (1 - src.a)`, so nothing reads the scene back.

#include "fullscreen.wgsl"
#include "sdf.wgsl"
#include "params.wgsl"

@group(0) @binding(0) var<uniform> params: Params;

// `x` (0..1) rounded to one of `bands` + 1 levels.
fn banded(x: f32, bands: f32) -> f32 {
  return round(clamp(x, 0.0, 1.0) * bands) / bands;
}

@fragment fn fs(in: FullscreenVarying) -> @location(0) vec4f {
  let texel = floor(in.position.xy / params.scale) + 0.5;
  let box = params.box;

  // Scrim: none above `reach` texels over the window, full by the window's middle.
  let top = box.y - params.reach;
  let dim = params.scrim * banded(smoothstep(top, box.y + box.w * 0.5, texel.y), 4.0);

  // Halo: distance outside the window's rounded outline, in texels; nothing inside it.
  let centre = box.xy + box.zw * 0.5;
  let d = sd_rounded_box_2d(texel - centre, box.zw * 0.5, 3.0);
  let falloff = 1.0 - clamp(d / params.halo_radius, 0.0, 1.0);
  let breath = 0.85 + 0.15 * sin(params.time * 1.3);
  let halo = select(0.0, banded(falloff * falloff, 3.0), d > 0.0) * params.glow * breath;

  return vec4f(params.glow_colour * halo, dim);
}
