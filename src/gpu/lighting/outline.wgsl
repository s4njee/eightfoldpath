// One-pixel outlines from a G-buffer (story 3.7), drawn over a finished scene.
//
// Reads, with textureLoad only (no sampler, so nothing blurs and depth needs no filtering):
//   gbuffer:   rgba16float, r g = view-space normal x y, b = object ID (outline-sprite.wgsl)
//   depth:     the G-buffer pass's depth32float
//   selection: depth32float holding only the selected object; cleared to 1 elsewhere
//
// A pixel p gets a line when it differs from one of its four neighbours q AND p is the nearer of
// the two. Testing the pair from both sides and keeping only the nearer one is what makes the
// line exactly one pixel wide and puts it on the foreground object, the way a pixel artist draws
// it, instead of a two-pixel line straddling the edge.
//
// The pass is drawn with alpha blending into the scene: lines are the ink colour at the ink
// opacity, everything else is left alone. Debug views write opaque pixels instead.

#include "fullscreen.wgsl"
#include "outline-params.wgsl"

@group(0) @binding(0) var<uniform> outline: Outline;
@group(0) @binding(1) var gbuffer: texture_2d<f32>;
@group(0) @binding(2) var scene_depth: texture_depth_2d;
@group(0) @binding(3) var selection_depth: texture_depth_2d;

// outline.flags.x: which sources are on.
const SOURCE_DEPTH = 1u;
const SOURCE_NORMAL = 2u;
const SOURCE_ID = 4u;
const SOURCE_SELECTION = 8u;

// outline.flags.y: what to draw.
const VIEW_FINAL = 0u;
const VIEW_DEPTH = 1u;
const VIEW_NORMALS = 2u;
const VIEW_IDS = 3u;
const VIEW_EDGES = 4u;

const SKY_ID = 0.0;

const NEIGHBOURS = array<vec2i, 4>(vec2i(1, 0), vec2i(-1, 0), vec2i(0, 1), vec2i(0, -1));

struct Surface {
  normal: vec3f,
  id: f32,
  // Linear view depth, world units.
  z: f32,
}

// wgpu-matrix's perspective maps view depth z to d = far / (far - near) * (1 - near / z).
fn linear_depth(d: f32) -> f32 {
  let near = outline.depth_range.x;
  let far = outline.depth_range.y;
  return near * far / (far - d * (far - near));
}

fn surface_at(p: vec2i) -> Surface {
  let g = textureLoad(gbuffer, p, 0);
  var s: Surface;
  s.normal = vec3f(g.xy, sqrt(max(0.0, 1.0 - dot(g.xy, g.xy))));
  s.id = round(g.z);
  s.z = linear_depth(textureLoad(scene_depth, p, 0));
  return s;
}

fn in_bounds(p: vec2i, size: vec2i) -> bool {
  return all(p >= vec2i(0)) && all(p < size);
}

// Bitmask of the enabled sources that put a line on p.
fn edge_sources(p: vec2i, size: vec2i) -> u32 {
  let here = surface_at(p);
  if (here.id == SKY_ID) {
    return 0u;
  }
  let w_here = 1.0 / here.z;
  // Each neighbour is also "the pixel behind p" for the opposite direction, so all four are
  // loaded once: five surfaces (ten loads) a pixel instead of nine.
  var around: array<Surface, 4>;
  var inside: array<bool, 4>;
  for (var i = 0u; i < 4u; i++) {
    inside[i] = in_bounds(p + NEIGHBOURS[i], size);
    if (inside[i]) {
      around[i] = surface_at(p + NEIGHBOURS[i]);
    }
  }
  var found = 0u;
  for (var i = 0u; i < 4u; i++) {
    if (!inside[i]) {
      continue;
    }
    let step = NEIGHBOURS[i];
    let there = around[i];
    // NEIGHBOURS pairs opposite directions: 0 and 1, 2 and 3.
    let behind = i ^ 1u;
    // Exact ties go to the right and lower pixel of the pair, so they still draw once, not twice.
    let tie_here = step.x + step.y > 0;
    let nearer = here.z < there.z || (here.z == there.z && tie_here);

    // Depth. 1/z is linear across a plane in screen space, so a flat floor at a grazing angle
    // changes depth a lot per pixel but continues the line through the pixel behind p exactly.
    // A step is a depth edge only when neither "same depth" nor "same slope" explains it; taking
    // the better of the two keeps the far side of a one-pixel feature from counting as a step.
    let w_there = 1.0 / there.z;
    var miss = abs(w_there - w_here);
    let beyond = p + 2 * step;
    if (inside[behind]) {
      miss = min(miss, abs(w_there - (2.0 * w_here - 1.0 / around[behind].z)));
    } else if (in_bounds(beyond, size)) {
      // At the border of the picture there is no pixel behind p; continue q's slope back to p.
      miss = min(miss, abs(w_here - (2.0 * w_there - 1.0 / surface_at(beyond).z)));
    }
    let step_in_depth = miss > outline.thresholds.x * w_here;
    if (nearer && step_in_depth) {
      found |= SOURCE_DEPTH;
    }
    if (nearer && there.id != here.id) {
      found |= SOURCE_ID;
    }
    // Normal. The sky has none, so it only ever makes a depth or ID edge. Across a silhouette the
    // line stays on the nearer side like the others. Across a crease, where depth is continuous,
    // "nearer" flips from pixel to pixel along the fold (both sides recede from it), which would
    // make a dotted line; there it goes on the side that faces the camera less instead, which is
    // the same side all along the crease.
    if (there.id != SKY_ID && dot(here.normal, there.normal) < outline.thresholds.y) {
      let turned_away = here.normal.z < there.normal.z
        || (here.normal.z == there.normal.z && tie_here);
      if (select(turned_away, nearer, step_in_depth)) {
        found |= SOURCE_NORMAL;
      }
    }
  }
  return found & outline.flags.x;
}

// The selection outline is drawn just outside the selected object's silhouette, so it never
// covers the art itself. 0 off the outline, 1 where the object is in view, `thresholds.z` where
// something stands in front of it: the outline shows through, dimmed (an x-ray selection).
fn selection_rim(p: vec2i, size: vec2i) -> f32 {
  if (textureLoad(selection_depth, p, 0) < 1.0) {
    return 0.0;
  }
  var rim = 0.0;
  for (var i = 0u; i < 4u; i++) {
    let q = p + NEIGHBOURS[i];
    if (!in_bounds(q, size)) {
      continue;
    }
    let mask = textureLoad(selection_depth, q, 0);
    if (mask < 1.0) {
      // Both depths come from the same quads drawn from the same camera, so a visible pixel of
      // the selection matches the scene to rounding. The tolerance is relative, a millimetre in
      // twenty metres.
      let visible = linear_depth(mask) <= linear_depth(textureLoad(scene_depth, q, 0)) * 1.0001;
      rim = max(rim, select(outline.thresholds.z, 1.0, visible));
    }
  }
  return rim;
}

fn id_colour(id: f32) -> vec3f {
  if (id == SKY_ID) {
    return vec3f(0.0);
  }
  // Golden-ratio hues: neighbouring IDs get far-apart colours.
  let hue = fract(id * 0.618034);
  let rgb = clamp(abs(fract(hue + vec3f(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, vec3f(0.0), vec3f(1.0));
  return mix(vec3f(0.15), rgb, 0.85);
}

@fragment fn fs_outline(in: FullscreenVarying) -> @location(0) vec4f {
  let p = vec2i(in.position.xy);
  let size = vec2i(textureDimensions(gbuffer));
  let view = outline.flags.y;

  if (view == VIEW_DEPTH) {
    let here = surface_at(p);
    let near = outline.depth_range.z;
    let far = outline.depth_range.w;
    let shade = select(1.0 - clamp((here.z - near) / (far - near), 0.0, 1.0), 0.0, here.id == SKY_ID);
    return vec4f(vec3f(shade * shade), 1.0);
  }
  if (view == VIEW_NORMALS) {
    let here = surface_at(p);
    return vec4f(select(here.normal * 0.5 + 0.5, vec3f(0.0), here.id == SKY_ID), 1.0);
  }
  if (view == VIEW_IDS) {
    return vec4f(id_colour(surface_at(p).id), 1.0);
  }

  let sources = edge_sources(p, size);
  var rim = 0.0;
  if ((outline.flags.x & SOURCE_SELECTION) != 0u) {
    rim = selection_rim(p, size);
  }

  if (view == VIEW_EDGES) {
    // Red depth, green normal, blue ID; a pixel found by several sources mixes their colours.
    var colour = vec3f(
      select(0.0, 1.0, (sources & SOURCE_DEPTH) != 0u),
      select(0.0, 1.0, (sources & SOURCE_NORMAL) != 0u),
      select(0.0, 1.0, (sources & SOURCE_ID) != 0u),
    );
    if (rim > 0.0) {
      colour = outline.select_color.rgb * rim;
    }
    return vec4f(colour, 1.0);
  }

  if (rim > 0.0) {
    return vec4f(outline.select_color.rgb, outline.select_color.a * rim);
  }
  if (sources != 0u) {
    return outline.ink;
  }
  return vec4f(0.0);
}
