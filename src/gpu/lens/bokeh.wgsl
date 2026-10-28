#include "bokeh-params.wgsl"
#include "bokeh-excess.wgsl"
#include "bokeh-aperture.wgsl"

// Bokeh highlights (story 5.2), after Sousa (CryENGINE 3 Graphics Gems, SIGGRAPH 2013) by way of
// Moon Temple's src/gpu/dof/sprites*.wgsl: the bright out-of-focus lights the tilt-shift lens held
// back from its gather are drawn as sprites of the aperture's shape. Four entry points:
//
//   extract   compute, one invocation per half-resolution texel of the lens's `prefiltered` target,
//             that is per 2 x 2 block of the sharp image. A blurred block brighter than the
//             threshold appends one point record through an atomic counter: placed at the centroid
//             of its pixels' light above the threshold, with the block's signed circle of confusion
//             and the light the lens left out (bokeh-excess.wgsl), summed over its four pixels.
//   finalise  compute, one invocation: the indirect draw's arguments, six vertices per sprite and
//             as many sprites as were appended, up to the cap.
//   sprite_vs one quad per record, read as an instance vertex buffer.
//   sprite_fs the aperture's share of the record's light at this pixel, added onto the lens's
//             output. A disc from behind the focus is hidden where the pixel's own surface is
//             clearly in front of it: where the pixel's circle of confusion (from `prefiltered`) is
//             under half the disc's, fading in by three quarters, so a sharp character or a blurred
//             foreground covers a lantern behind it, while the ground the lantern stands on, a
//             little nearer, does not eat the disc's edge. A disc from in front is over everything.

@group(0) @binding(0) var<uniform> params: BokehParams;
@group(0) @binding(1) var colour_tex: texture_2d<f32>;
@group(0) @binding(2) var half_tex: texture_2d<f32>;

struct BokehPoint {
  /// (x, y, signed radius, unused): full-resolution pixels.
  at: vec4f,
  /// (r, g, b, unused): the disc's whole light, colour times pixels.
  light: vec4f,
}

@group(0) @binding(3) var<storage, read_write> points: array<BokehPoint>;
@group(0) @binding(4) var<storage, read_write> counter: atomic<u32>;
@group(0) @binding(5) var<storage, read_write> args: array<u32, 4>;

@compute @workgroup_size(8, 8)
fn extract(@builtin(global_invocation_id) id: vec3u) {
  let texel = vec2i(id.xy);
  if (any(texel >= vec2i(params.half_size))) {
    return;
  }
  let coc = textureLoad(half_tex, texel, 0).a;
  let drawn = bokeh_drawn(coc);
  if (drawn <= 0.0) {
    return;
  }
  // The same four pixels the lens's prefilter averaged, clamped at the edge the same way.
  let base = texel * 2;
  let size = vec2i(params.out_size);
  var sum = vec3f(0.0);
  var centroid = vec2f(0.0);
  var weight = 0.0;
  for (var k = 0; k < 4; k++) {
    let p = min(base + vec2i(k & 1, k >> 1), size - 1);
    let c = textureLoad(colour_tex, p, 0).rgb;
    sum += c;
    let w = max(bokeh_luminance(c) - params.threshold, 0.0);
    centroid += w * (vec2f(p) + 0.5);
    weight += w;
  }
  let excess = bokeh_excess(sum * 0.25, params.threshold);
  if (bokeh_luminance(excess) <= 0.0) {
    return;
  }
  let index = atomicAdd(&counter, 1u);
  if (index >= params.capacity) {
    return;
  }
  let at = select(vec2f(base) + 1.0, centroid / weight, weight > 0.0);
  // The excess is an average over four pixels, so the block's light is four times it.
  points[index] = BokehPoint(vec4f(at, coc, 0.0), vec4f(excess * (4.0 * drawn), 0.0));
}

@compute @workgroup_size(1)
fn finalise() {
  args[0] = 6u;
  args[1] = min(atomicLoad(&counter), params.capacity);
  args[2] = 0u;
  args[3] = 0u;
}

struct SpriteVarying {
  @builtin(position) position: vec4f,
  /// Offset from the disc's centre, full-resolution pixels.
  @location(0) offset: vec2f,
  @location(1) @interpolate(flat) radius: f32,
  @location(2) @interpolate(flat) light: vec3f,
  @location(3) @interpolate(flat) field: vec2f,
}

@vertex fn sprite_vs(
  @builtin(vertex_index) vertex: u32,
  @location(0) at: vec4f,
  @location(1) light: vec4f,
) -> SpriteVarying {
  let corners = array(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  // Room for the edge ramp and the pixel the smallest disc spreads over.
  let half = max(abs(at.z), APERTURE_MIN_RADIUS) + 1.5;
  let offset = corners[vertex] * half;
  let pixel = at.xy + offset;
  let centre = 0.5 * params.out_size;
  var out: SpriteVarying;
  out.position = vec4f(pixel / params.out_size * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), 0.0, 1.0);
  out.offset = offset;
  out.radius = at.z;
  out.light = light.rgb * params.intensity;
  out.field = (at.xy - centre) / length(centre);
  return out;
}

@fragment fn sprite_fs(in: SpriteVarying) -> @location(0) vec4f {
  let a = Aperture(
    params.blades, params.rotation, params.curvature, params.unit_area, params.rim,
    params.cat_eye, in.field);
  var share = aperture_light(in.offset, in.radius, a);
  if (in.radius > 0.0) {
    let texel = min(vec2i(in.position.xy * 0.5), vec2i(params.half_size) - 1);
    let own = textureLoad(half_tex, texel, 0).a;
    share *= smoothstep(0.5, 0.75, own / in.radius);
  }
  if (share <= 0.0) {
    discard;
  }
  return vec4f(in.light * share, 0.0);
}
