#include "fullscreen.wgsl"
#include "tilt-shift-params.wgsl"
#include "tilt-shift-depth.wgsl"

// The tilt-shift lens (story 5.1): two ways of blurring a diorama so it reads as a miniature.
//
// `depth` is a gather depth of field after Jimenez (SIGGRAPH 2014), ported from Moon Temple's
// src/gpu/dof/gather.wgsl. Six passes:
//
//   ts_prefilter  half resolution: the colour averaged over each 2 x 2 block, and the block's signed
//                 circle of confusion (full-resolution pixels, negative in front of focus), taken
//                 from the nearest of its four pixels so a foreground edge never thins away.
//   ts_spread     half resolution: each texel's colour spread over the cell one tap of its own ring
//                 kernel stands for. Without it a small bright lantern in a large blur is picked up
//                 only by the taps that land on it and draws the kernel's rings instead of a disc.
//   ts_tiles      one texel per 16 x 16 full-resolution pixels: the largest near-field radius in it.
//   ts_dilate     each tile takes the largest near radius of any tile whose blur can reach it, so a
//                 blurred foreground spreads over the in-focus tiles beside it.
//   ts_gather     half resolution, two targets: the far field (what lies behind, blurred by each
//                 pixel's own circle) and the near field (the foreground, gathered as far as the
//                 tile's dilated radius, premultiplied by how much of the pixel it covers).
//   ts_composite  full resolution: the sharp image or the far field by the pixel's circle, then the
//                 near field over it by its alpha.
//
// The two fields are kept apart (Jimenez's presort): a blurred background never bleeds over a sharp
// foreground, because a far tap counts only where its own circle reaches back to the pixel, and a
// blurred foreground still spreads over a sharp edge, because the near field looks as far as the
// nearest blurred foreground can reach rather than as far as the in-focus pixel's own zero radius.
//
// `screen` needs no depth: the circle of confusion grows with distance from a horizontal line, the
// tilt-shift photo filter. Its radius depends on the row alone, so a horizontal Gaussian is exact
// and a vertical one with each row's own radius is close enough:
//
//   ts_screen_down       half resolution: the 2 x 2 average and the row's signed circle.
//   ts_screen_h          half resolution: a horizontal Gaussian of sigma = radius / 2, the spread of
//                        a disc of that radius.
//   ts_screen_v          the same, vertically.
//   ts_screen_composite  full resolution: the sharp image or the blurred one by the row's circle.

@group(0) @binding(0) var<uniform> params: TiltShiftParams;
@group(0) @binding(1) var linear: sampler;

// Each pass reads its own inputs; an automatic layout only has the ones a stage uses. The depth
// texture is binding 1, declared by tilt-shift-depth.wgsl as multisampled or not.
@group(1) @binding(0) var colour_tex: texture_2d<f32>;
@group(1) @binding(2) var half_tex: texture_2d<f32>;
@group(1) @binding(3) var tile_tex: texture_2d<f32>;
@group(1) @binding(4) var dilated_tex: texture_2d<f32>;
@group(1) @binding(5) var far_tex: texture_2d<f32>;
@group(1) @binding(6) var near_tex: texture_2d<f32>;
@group(1) @binding(7) var spread_tex: texture_2d<f32>;
@group(1) @binding(8) var blur_tex: texture_2d<f32>;

const VIEW_COC: f32 = 1.0;
const VIEW_NEAR: f32 = 2.0;
const VIEW_FAR: f32 = 3.0;

/// Full-resolution pixels per tile side: 8 x 8 texels of the half-resolution image.
const TILE: f32 = 16.0;
const TILE_HALF: i32 = 8;
/// The ring kernel: a centre tap and rings of 8, 16 and 24 taps, 49 in all. Ring k sits at
/// k / 3.5 of the kernel's radius and owns the annulus half a ring either side of it; with 8k taps
/// on ring k every tap owns the same share of the disc, 1 / 49, out to its edge.
const RINGS: i32 = 3;
const TAPS: f32 = 49.0;
const PI: f32 = 3.14159265;

// ---- circle of confusion ---------------------------------------------------------------------

/// Distance along the view axis of a depth-buffer value, from the projection's third and fourth
/// rows (`depth_to_distance` = P[10], P[14], P[11], P[15], column-major). Works for perspective,
/// reversed and orthographic projections alike: d = (P10 z + P14) / (P11 z + P15) solved for z.
fn view_distance(d: f32) -> f32 {
  let p = params.depth_to_distance;
  return (p.y - d * p.w) / (p.x - d * p.z);
}

/// The focus band: sharp within `band_half` of the focus distance, then growing linearly to the
/// largest radius over `near_transition` world units in front and `far_transition` behind.
/// Signed: negative in front.
fn coc_from_distance(z: f32) -> f32 {
  let off = abs(z - params.focus) - params.band_half;
  let near = z < params.focus;
  let transition = select(params.far_transition, params.near_transition, near);
  let r = params.max_radius * clamp(off / max(transition, 1e-4), 0.0, 1.0);
  return select(r, -r, near);
}

/// The screen method's circle at full-resolution row `y`: sharp within `line_band` of the line,
/// growing over `line_transition` (both shares of the image height). Below the line counts as
/// in front, since the bottom of a pitched-down view is the nearest ground.
fn coc_from_row(y: f32) -> f32 {
  let v = y / params.out_size.y;
  let off = abs(v - params.line) - params.line_band;
  let r = params.max_radius * clamp(off / max(params.line_transition, 1e-4), 0.0, 1.0);
  return select(r, -r, v > params.line);
}

fn distance_at(pixel: vec2i) -> f32 {
  let p = clamp(pixel, vec2i(0), vec2i(params.out_size) - 1);
  return view_distance(load_depth(p));
}

/// The inspector's circle-of-confusion view: the scene in dim grey, warm where the foreground is
/// blurred and cool where the background is, brighter for a larger circle.
fn coc_colour(coc: f32, sharp: vec3f) -> vec4f {
  let grey = vec3f(clamp(dot(sharp, vec3f(0.2126, 0.7152, 0.0722)), 0.0, 1.0) * 0.3);
  let t = clamp(abs(coc) / max(params.max_radius, 1.0), 0.0, 1.0);
  let tint = select(vec3f(0.15, 0.45, 1.0), vec3f(1.0, 0.45, 0.1), coc < 0.0);
  return vec4f(mix(grey, tint, t), 1.0);
}

// ---- depth: prefilter ------------------------------------------------------------------------

@fragment fn ts_prefilter(in: FullscreenVarying) -> @location(0) vec4f {
  let base = vec2i(in.position.xy) * 2;
  var sum = vec3f(0.0);
  // The block takes the circle of its nearest pixel: a foreground edge then never thins away at
  // half resolution, and the near field errs on the side of covering a little more.
  var nearest = 1e30;
  for (var j = 0; j < 2; j++) {
    for (var i = 0; i < 2; i++) {
      let p = min(base + vec2i(i, j), vec2i(params.out_size) - 1);
      sum += textureLoad(colour_tex, p, 0).rgb;
      nearest = min(nearest, distance_at(p));
    }
  }
  return vec4f(sum * 0.25, coc_from_distance(nearest));
}

// ---- depth: spread ---------------------------------------------------------------------------

/// A 3 x 3 grid of bilinear taps a third of the ring spacing apart (|coc| / 3.5 full-resolution
/// pixels between rings), covering about one tap's cell. A tap counts in proportion to how alike its
/// circle is to the centre's, so a sharp edge never spreads into a blurred field or back.
@fragment fn ts_spread(in: FullscreenVarying) -> @location(0) vec4f {
  let size = params.half_size;
  let centre = textureLoad(half_tex, vec2i(in.position.xy), 0);
  let step = abs(centre.a) / 3.5 / 2.0 / 3.0;
  if (step < 0.5) {
    return centre;
  }
  var sum = vec3f(0.0);
  var weight = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let q = in.position.xy + vec2f(f32(i), f32(j)) * step;
      let texel = clamp(vec2i(floor(q)), vec2i(0), vec2i(size) - 1);
      let coc = textureLoad(half_tex, texel, 0).a;
      let w = clamp(1.0 - abs(coc - centre.a) / max(0.5 * abs(centre.a), 1.0), 0.0, 1.0);
      sum += textureSampleLevel(half_tex, linear, q / size, 0.0).rgb * w;
      weight += w;
    }
  }
  return vec4f(sum / max(weight, 1e-4), centre.a);
}

// ---- depth: tiles and dilation ---------------------------------------------------------------

@fragment fn ts_tiles(in: FullscreenVarying) -> @location(0) vec4f {
  let base = vec2i(in.position.xy) * TILE_HALF;
  let size = vec2i(params.half_size);
  var near = 0.0;
  for (var j = 0; j < TILE_HALF; j++) {
    for (var i = 0; i < TILE_HALF; i++) {
      let coc = textureLoad(half_tex, min(base + vec2i(i, j), size - 1), 0).a;
      near = max(near, -coc);
    }
  }
  return vec4f(near, 0.0, 0.0, 1.0);
}

@fragment fn ts_dilate(in: FullscreenVarying) -> @location(0) vec4f {
  let tile = vec2i(in.position.xy);
  let count = vec2i(textureDimensions(tile_tex));
  // Jimenez dilates over the 3 x 3 neighbours with tiles as big as the largest blur. Smaller tiles
  // fit the kernel more tightly, so the neighbourhood grows instead: as many tiles as the largest
  // blur spans. A neighbour counts only if its radius reaches across the gap between the two tiles.
  let span = i32(ceil(params.max_radius / TILE));
  var reach = 0.0;
  for (var j = -span; j <= span; j++) {
    for (var i = -span; i <= span; i++) {
      let n = tile + vec2i(i, j);
      if (any(n < vec2i(0)) || any(n >= count)) {
        continue;
      }
      let near = textureLoad(tile_tex, n, 0).r;
      let gap = vec2f(max(abs(vec2i(i, j)) - 1, vec2i(0))) * TILE;
      if (near > length(gap)) {
        reach = max(reach, near);
      }
    }
  }
  return vec4f(reach, 0.0, 0.0, 1.0);
}

// ---- depth: gather ---------------------------------------------------------------------------

/// Offset of tap `index` on ring `ring` (1..RINGS), in units of the kernel radius. Odd rings are
/// turned half a step so no two rings line up into spokes, and the whole kernel is turned by
/// `turn.x` (a fraction of a step) so neighbouring pixels sample different places. Every ring is
/// also moved in or out by `turn.y` (-0.5 to 0.5 of the gap between rings) within the annulus it
/// owns: turning alone leaves the rings at fixed distances, and a small bright lantern inside a
/// large blur is then picked up only at those distances and drawn as concentric circles.
fn ring_tap(ring: i32, index: i32, turn: vec2f) -> vec2f {
  let count = f32(8 * ring);
  let angle = 2.0 * PI * (f32(index) + 0.5 * f32(ring & 1) + turn.x) / count;
  return vec2f(cos(angle), sin(angle)) * (f32(ring) + turn.y) / (f32(RINGS) + 0.5);
}

/// Interleaved gradient noise (Jimenez 2014, the same talk): a per-pixel value in [0, 1) whose
/// neighbours differ as much as possible, so the composite's small filter averages it away.
fn interleaved_gradient_noise(pixel: vec2f) -> f32 {
  return fract(52.9829189 * fract(dot(pixel, vec2f(0.06711056, 0.00583715))));
}

struct Sample {
  colour: vec3f,
  coc: f32,
}

/// The spread half-resolution image at full-resolution position `q`: its colour filtered, its
/// circle unfiltered (a circle averaged across a silhouette belongs to neither side).
fn sample_at(q: vec2f) -> Sample {
  let size = params.half_size;
  let colour = textureSampleLevel(spread_tex, linear, q / (2.0 * size), 0.0).rgb;
  let texel = clamp(vec2i(floor(q * 0.5)), vec2i(0), vec2i(size) - 1);
  return Sample(colour, textureLoad(spread_tex, texel, 0).a);
}

struct Fields {
  @location(0) far: vec4f,
  @location(1) near: vec4f,
}

/// The far field at `p`: what lies behind. For a background pixel (circle `coc` > 0) a disc of its
/// own radius, where a tap counts only if its own circle reaches back to the pixel (a gather standing
/// in for a scatter), capped at the pixel's: light from further back is hidden by the pixel's own
/// surface beyond that. Taps in front of focus are the near field's and are left out, which is what
/// keeps a blurred background off a sharp foreground sprite.
///
/// For a foreground pixel (`coc` < 0) it is a guess at the background hidden behind it: the
/// non-foreground taps within its radius, weighted steeply towards the nearest. Where the blurred
/// foreground is see-through, near its edge, the composite shows this through it rather than the
/// foreground's own sharp colour; without it a blurred near tree turns into an opaque slab.
fn far_field(p: vec2f, centre: Sample, turn: vec2f) -> vec4f {
  let radius = abs(centre.coc);
  if (radius < 1.0) {
    return vec4f(centre.colour, 1.0);
  }
  var sum = vec3f(0.0);
  var weight = 0.0;
  for (var ring = 0; ring <= RINGS; ring++) {
    let taps = max(8 * ring, 1);
    for (var index = 0; index < taps; index++) {
      let offset = select(vec2f(0.0), ring_tap(ring, index, turn), ring > 0) * radius;
      var s = centre;
      if (ring > 0) {
        s = sample_at(p + offset);
      }
      let d = length(offset);
      var w = 0.0;
      if (centre.coc > 0.0) {
        w = select(0.0, clamp(min(s.coc, centre.coc) - d + 1.0, 0.0, 1.0), s.coc > 0.0);
      } else {
        w = select(0.0, 1.0, s.coc > -1.0) * pow(1.0 - d / (radius + 1.0), 4.0);
      }
      sum += s.colour * w;
      weight += w;
    }
  }
  if (weight < 1e-3) {
    return vec4f(centre.colour, 1.0);
  }
  return vec4f(sum / weight, 1.0);
}

/// The near field at `p`: the foreground blurred over everything behind it, premultiplied by its
/// alpha. The kernel's radius R is the tile's dilated near radius, the furthest any foreground
/// nearby can spread. A tap in front of focus counts where its own circle (radius r) covers the
/// pixel, and its light is spread over that circle's area: standing for 1 / 49 of the kernel's disc,
/// it adds R² / (49 r²) to the pixel's coverage. A foreground filling the kernel then gives an alpha
/// of one, and a straight edge one half at the edge, falling to nothing r beyond it. Foreground
/// blurred by only a pixel or two fades out of the near field and is left to the sharp image.
fn near_field(p: vec2f, centre: Sample, kernel: f32, turn: vec2f) -> vec4f {
  if (kernel < 1.0) {
    return vec4f(0.0);
  }
  var sum = vec3f(0.0);
  var alpha = 0.0;
  for (var ring = 0; ring <= RINGS; ring++) {
    let taps = max(8 * ring, 1);
    for (var index = 0; index < taps; index++) {
      let offset = select(vec2f(0.0), ring_tap(ring, index, turn), ring > 0) * kernel;
      var s = centre;
      if (ring > 0) {
        s = sample_at(p + offset);
      }
      let r = -s.coc;
      let cover = clamp(r - length(offset) + 1.0, 0.0, 1.0) * smoothstep(1.0, 4.0, r);
      let a = cover * kernel * kernel / (TAPS * max(r * r, 1.0));
      sum += s.colour * a;
      alpha += a;
    }
  }
  if (alpha < 1e-4) {
    return vec4f(0.0);
  }
  // Premultiplied, so the composite's filtering never darkens the field's soft edge.
  let coverage = min(alpha, 1.0);
  return vec4f(sum / alpha * coverage, coverage);
}

@fragment fn ts_gather(in: FullscreenVarying) -> Fields {
  // Work in full-resolution pixels: the centre of this half-resolution texel's 2 x 2 block.
  let p = in.position.xy * 2.0;
  let texel = vec2i(in.position.xy);
  let own = textureLoad(spread_tex, texel, 0);
  let centre = Sample(own.rgb, own.a);
  let tile = min(texel / TILE_HALF, vec2i(textureDimensions(dilated_tex)) - 1);
  let kernel = textureLoad(dilated_tex, tile, 0).r;
  // The kernel is turned and its rings moved per pixel: a bright point falls between a fixed
  // kernel's taps and draws them; a moving kernel spreads that into fine noise that the
  // composite's filter removes. The second value is the same noise at a far offset, uncorrelated.
  let turn = vec2f(
    interleaved_gradient_noise(in.position.xy),
    interleaved_gradient_noise(in.position.xy + vec2f(5.588238, 5.588238)) - 0.5,
  );
  return Fields(far_field(p, centre, turn), near_field(p, centre, kernel, turn));
}

// ---- depth: composite ------------------------------------------------------------------------

/// A half-resolution field read with a 3 x 3 tent: four bilinear reads half a texel apart. It
/// smooths the noise of the turned kernel, where Jimenez uses a 3 x 3 median.
fn smoothed(tex: texture_2d<f32>, uv: vec2f) -> vec4f {
  let step = 0.5 / params.half_size;
  return 0.25 * (textureSampleLevel(tex, linear, uv + vec2f(-step.x, -step.y), 0.0) +
    textureSampleLevel(tex, linear, uv + vec2f(step.x, -step.y), 0.0) +
    textureSampleLevel(tex, linear, uv + vec2f(-step.x, step.y), 0.0) +
    textureSampleLevel(tex, linear, uv + vec2f(step.x, step.y), 0.0));
}

@fragment fn ts_composite(in: FullscreenVarying) -> @location(0) vec4f {
  let pixel = vec2i(in.position.xy);
  let sharp = textureLoad(colour_tex, pixel, 0).rgb;
  let coc = coc_from_distance(distance_at(pixel));
  let uv = in.position.xy / (2.0 * params.half_size);
  let far = smoothed(far_tex, uv).rgb;
  let near = smoothed(near_tex, uv);
  if (params.view == VIEW_COC) {
    return coc_colour(coc, sharp);
  }
  if (params.view == VIEW_NEAR) {
    return vec4f(near.rgb, 1.0);
  }
  if (params.view == VIEW_FAR) {
    return vec4f(far, 1.0);
  }
  // Behind: the sharp image where the pixel is in focus, the far field where it is blurred by more
  // than a few pixels (half resolution blurs too much for less). For a foreground pixel the far
  // field holds the background guessed behind it, shown only where the near field is see-through.
  let background = mix(sharp, far, smoothstep(1.0, 4.0, abs(coc)));
  return vec4f(background * (1.0 - near.a) + near.rgb, 1.0);
}

// ---- screen ----------------------------------------------------------------------------------

@fragment fn ts_screen_down(in: FullscreenVarying) -> @location(0) vec4f {
  let base = vec2i(in.position.xy) * 2;
  var sum = vec3f(0.0);
  for (var j = 0; j < 2; j++) {
    for (var i = 0; i < 2; i++) {
      sum += textureLoad(colour_tex, min(base + vec2i(i, j), vec2i(params.out_size) - 1), 0).rgb;
    }
  }
  // position.y * 2 is the middle of the block's two full-resolution rows.
  return vec4f(sum * 0.25, coc_from_row(in.position.y * 2.0));
}

/// One direction of the Gaussian, at most 12 taps a side: one texel apart while the blur is small,
/// spread further (bilinear, so still smooth) as it grows.
fn screen_blur(tex: texture_2d<f32>, position: vec2f, direction: vec2f) -> vec4f {
  let centre = textureLoad(tex, vec2i(position), 0);
  // The radius in half-resolution texels is |coc| / 2; sigma is half the radius.
  let sigma = abs(centre.a) * 0.25;
  if (sigma < 0.25) {
    return centre;
  }
  let steps = min(ceil(3.0 * sigma), 12.0);
  let spacing = 3.0 * sigma / steps;
  var sum = centre.rgb;
  var weight = 1.0;
  for (var k = 1; k <= i32(steps); k++) {
    let x = f32(k) * spacing;
    let w = exp(-0.5 * x * x / (sigma * sigma));
    let offset = direction * x / params.half_size;
    let uv = position / params.half_size;
    sum += (textureSampleLevel(tex, linear, uv + offset, 0.0).rgb +
      textureSampleLevel(tex, linear, uv - offset, 0.0).rgb) * w;
    weight += 2.0 * w;
  }
  return vec4f(sum / weight, centre.a);
}

@fragment fn ts_screen_h(in: FullscreenVarying) -> @location(0) vec4f {
  return screen_blur(half_tex, in.position.xy, vec2f(1.0, 0.0));
}

@fragment fn ts_screen_v(in: FullscreenVarying) -> @location(0) vec4f {
  return screen_blur(blur_tex, in.position.xy, vec2f(0.0, 1.0));
}

@fragment fn ts_screen_composite(in: FullscreenVarying) -> @location(0) vec4f {
  let pixel = vec2i(in.position.xy);
  let sharp = textureLoad(colour_tex, pixel, 0).rgb;
  let coc = coc_from_row(in.position.y);
  let blurred = textureSampleLevel(blur_tex, linear, in.position.xy / (2.0 * params.half_size), 0.0).rgb;
  if (params.view == VIEW_COC) {
    return coc_colour(coc, sharp);
  }
  // There are no fields here: the near view is the blurred image below the line, the far view
  // the blurred image above it.
  if (params.view == VIEW_NEAR) {
    return vec4f(select(vec3f(0.0), blurred, coc < -0.5), 1.0);
  }
  if (params.view == VIEW_FAR) {
    return vec4f(select(vec3f(0.0), blurred, coc > 0.5), 1.0);
  }
  return vec4f(mix(sharp, blurred, smoothstep(1.0, 4.0, abs(coc))), 1.0);
}
