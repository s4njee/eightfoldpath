// texel-snap.wgsl -- shade at the centre of the texel, not the centre of the pixel (story 3.9).
//
// Pixel art magnified on screen covers each texel with many pixels. Lit per pixel, a light's
// falloff or a shadow edge runs smoothly through the middle of a texel, which reads as the texture
// being a print on a smooth surface ("mixels": pixels of a different size from the art's). Lit at
// the texel's centre, every pixel of a texel gets the same light, so light edges follow the art's
// grid.
//
// The centre is found from screen-space derivatives. On a flat quad (a sprite, a tile) world
// position is an affine function of texel coordinates, and the 2 × 2 Jacobian from screen to
// texels can be inverted, so:
//
//   step in pixels that reaches the texel centre:  s = (d texel / d screen)^-1 · (centre - texel)
//   world position there:                          world + (d world / d screen) · s
//
// Both derivatives belong to the same primitive, even in helper invocations at its edge, and the
// ratio is exact for a plane however the derivatives were taken, so there is no seam at a quad's
// edge or along its diagonal. On curved geometry it would only be a first-order estimate.

// The world-space move from `texel` to the centre of its texel, given the four derivatives.
// Separate from the derivatives themselves so it can be tested, and called anywhere.
fn texel_centre_offset(
  texel: vec2f,
  dtexel_dx: vec2f,
  dtexel_dy: vec2f,
  dworld_dx: vec3f,
  dworld_dy: vec3f,
) -> vec3f {
  let det = dtexel_dx.x * dtexel_dy.y - dtexel_dy.x * dtexel_dx.y;
  // Edge-on: the texel is a line on screen and has no centre worth moving to.
  if (abs(det) < 1e-12) {
    return vec3f(0.0);
  }
  let delta = floor(texel) + 0.5 - texel;
  let steps = vec2f(
    dtexel_dy.y * delta.x - dtexel_dy.x * delta.y,
    dtexel_dx.x * delta.y - dtexel_dx.y * delta.x,
  ) / det;
  return dworld_dx * steps.x + dworld_dy * steps.y;
}

// How much of the move to make. Snapping only helps while a texel covers at least a pixel; once
// several texels share a pixel, one centre per pixel is nearest sampling of the light and crawls
// under motion (texel-sampling's notes). Full strength up to one texel per pixel, none from two.
fn texel_snap_weight(texel_footprint: vec2f) -> f32 {
  return clamp(2.0 - max(texel_footprint.x, texel_footprint.y), 0.0, 1.0);
}

// The world position at the centre of the texel under this fragment. Takes derivatives, so call it
// in uniform control flow (before any discard or branch on a varying).
fn texel_centre_world(texel: vec2f, world: vec3f) -> vec3f {
  let dtexel_dx = dpdx(texel);
  let dtexel_dy = dpdy(texel);
  let offset = texel_centre_offset(texel, dtexel_dx, dtexel_dy, dpdx(world), dpdy(world));
  return world + offset * texel_snap_weight(abs(dtexel_dx) + abs(dtexel_dy));
}
