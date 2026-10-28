// bokeh-aperture.wgsl -- the shape a defocused highlight takes (story 5.2), ported from Moon Temple's
// src/wgsl/aperture.wgsl with its onion rings, mirror-lens hole and drawn outlines left out.
//
// A point of light out of focus is an image of the lens's aperture scaled to its circle of
// confusion. `aperture_light(offset, radius, a)` is the share of a point's light that falls on the
// pixel `offset` device pixels from its centre, for a signed radius (negative in front of focus,
// which flips the shape). Summed over every pixel it is 1, so a disc's light does not change with
// its size or shape.
//
// The shape is a regular polygon of `blades` sides (0 for a circle), rounded towards the circle by
// `curvature`, described by its radius r(theta) at each angle with circumradius 1. The profile
// across it, 1 + rim (3 rho^4 - 1) in rho = |x| / r(theta), has mean 1 over any such shape, so the
// shape is normalised by its area alone (`unit_area`, worked out on the CPU by `apertureArea` in
// src/gpu/lens/bokeh.ts). A positive rim is the bright edge of over-corrected spherical aberration,
// soap-bubble bokeh; a negative one the soft edge of under-correction.
//
// `cat_eye` clips the shape with a second disc offset away from the image centre: mechanical
// vignetting, which turns the discs near the edges of the frame into cat's eyes. It removes light,
// as it does in a lens.
//
// Edges are a one-pixel linear ramp on an approximate distance (its integral over a convex shape is
// the area plus pi / 12 px^2, Steiner's formula). Below a radius of about three pixels no shape can
// be seen, so the light is the exact area of the pixel inside a disc instead, which conserves the
// light of a point however small and wherever it sits.

struct Aperture {
  blades: f32,
  /** Radians. */
  rotation: f32,
  /** 0 straight blades, 1 a circle. */
  curvature: f32,
  /** Area of the shape with circumradius 1. */
  unit_area: f32,
  rim: f32,
  /** Cat's-eye strength, 0..1. */
  cat_eye: f32,
  /** Where the point sits, relative to the image centre, in half-diagonals (0 centre, 1 corner). */
  field: vec2f,
}

const APERTURE_PI: f32 = 3.14159265358979;
/// Smallest radius drawn: a point in focus still covers a pixel's worth of area.
const APERTURE_MIN_RADIUS: f32 = 0.5;

/// The shape's radius at angle `theta`, circumradius 1.
fn aperture_radius(theta: f32, a: Aperture) -> f32 {
  if (a.blades < 3.0) {
    return 1.0;
  }
  let sector = 2.0 * APERTURE_PI / a.blades;
  let t = theta - a.rotation;
  let local = t - sector * floor(t / sector) - 0.5 * sector;
  return mix(cos(0.5 * sector) / cos(local), 1.0, a.curvature);
}

fn aperture_profile(rho: f32, a: Aperture) -> f32 {
  let r2 = rho * rho;
  return max(1.0 + a.rim * (3.0 * r2 * r2 - 1.0), 0.0);
}

/// Antiderivative of sqrt(r^2 - u^2), constant outside [-r, r].
fn _aperture_chord_int(u: f32, r: f32) -> f32 {
  let x = clamp(u, -r, r);
  return 0.5 * (x * sqrt(max(r * r - x * x, 0.0)) + r * r * asin(clamp(x / r, -1.0, 1.0)));
}

/// Antiderivative over x of clamp(y, -h(x), h(x)), h(x) = sqrt(r^2 - x^2), zero outside the disc.
fn _aperture_band_int(u: f32, y: f32, r: f32) -> f32 {
  let s = sign(y);
  if (abs(y) >= r) {
    return s * _aperture_chord_int(u, r);
  }
  let w = sqrt(r * r - y * y);
  let x = clamp(u, -r, r);
  let left = s * _aperture_chord_int(-w, r);
  if (x <= -w) {
    return s * _aperture_chord_int(x, r);
  }
  if (x <= w) {
    return left + y * (x + w);
  }
  return left + 2.0 * w * y + s * (_aperture_chord_int(x, r) - _aperture_chord_int(w, r));
}

/// Exact area of the pixel [x0, x1] x [y0, y1] inside a disc of radius r at the origin.
fn aperture_disc_area(x0: f32, x1: f32, y0: f32, y1: f32, r: f32) -> f32 {
  let top = _aperture_band_int(x1, y1, r) - _aperture_band_int(x0, y1, r);
  let bottom = _aperture_band_int(x1, y0, r) - _aperture_band_int(x0, y0, r);
  return max(top - bottom, 0.0);
}

fn aperture_light(offset: vec2f, radius: f32, a: Aperture) -> f32 {
  let r = max(abs(radius), APERTURE_MIN_RADIUS);
  // Small: the exact share of a disc inside this pixel.
  var small = 0.0;
  if (r < 4.0) {
    small = aperture_disc_area(offset.x - 0.5, offset.x + 0.5, offset.y - 0.5, offset.y + 0.5, r) /
      (APERTURE_PI * r * r);
  }
  // Large: the shape, its profile and the cat's eye, with a one-pixel edge.
  var large = 0.0;
  if (r > 2.5) {
    // In front of focus the image of the aperture is flipped.
    let p = select(offset, -offset, radius < 0.0) / r;
    let edge = aperture_radius(atan2(p.y, p.x), a);
    let rho = length(p) / edge;
    let inside = clamp(0.5 - (rho - 1.0) * edge * r, 0.0, 1.0);
    let clip = p + a.field * a.cat_eye * 1.2;
    let cat = clamp(0.5 - (length(clip) - 1.0) * r, 0.0, 1.0);
    let area = a.unit_area * r * r + APERTURE_PI / 12.0;
    large = min(inside, cat) * aperture_profile(min(rho, 1.0), a) / area;
  }
  return mix(small, large, smoothstep(2.5, 4.0, r));
}
