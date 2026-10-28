// bokeh-excess.wgsl -- which light becomes a shaped bokeh disc (story 5.2), shared by the lens's
// prefilter (tilt-shift.wgsl), which holds it back from the gather, and the bokeh pass's extract
// (bokeh-extract.wgsl), which draws it. Both read the same 2 x 2 block, so they agree exactly and no
// light is counted twice. The TypeScript twins are `bokehExcess`, `bokehHeld` and `bokehDrawn` in
// src/gpu/lens/bokeh.ts.

fn bokeh_luminance(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

/// The light above `threshold` in luminance, with the colour's hue: c (L - T) / L, nothing at or
/// below it. What it leaves has luminance exactly `threshold`, so the split is continuous in
/// brightness and a light fading through the threshold never pops. A threshold of 0 is off.
fn bokeh_excess(c: vec3f, threshold: f32) -> vec3f {
  let l = bokeh_luminance(c);
  if (threshold <= 0.0 || l <= threshold) {
    return vec3f(0.0);
  }
  return c * ((l - threshold) / l);
}

/// Whether a block of this signed circle of confusion (full-resolution pixels) gives up its
/// highlight: once it is blurred by a pixel, where the lens's composite starts to show the gather.
fn bokeh_held(coc: f32) -> bool {
  return abs(coc) >= 1.0;
}

/// The share of a held-back highlight the bokeh pass draws. The composite shows the sharp image,
/// which still has the highlight, by 1 - smoothstep(1, 4, |coc|) and the gather by the rest, so the
/// disc carries exactly what the composite would otherwise have lost.
fn bokeh_drawn(coc: f32) -> f32 {
  return select(0.0, smoothstep(1.0, 4.0, abs(coc)), bokeh_held(coc));
}
