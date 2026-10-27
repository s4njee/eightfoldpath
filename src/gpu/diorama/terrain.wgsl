// The tile extruder (story 4.2): every column of a scene in one instanced draw.
//
// Each instance is one box from extrude.ts. The vertex stage builds its five visible faces (the
// bottom is never seen) from the vertex index: a top through its four corner heights, and four
// sides that run down to the ground beside them. A side with nothing to show collapses to a line.
//
// Art is mapped by world position at the shared density, 16 texels a unit, and repeats across the
// scene: a tile image covers about six cells, so terrain and sprites have the same texel size.
// Sides are mapped down from the top edge, so a cliff image's grass fringe always sits along the
// top of a wall whatever its height. Where two tops of different art meet at the same height they
// are dithered together over a few texels, in whole texels: an auto-tiled edge with no edge art.
//
// The colour is decided by `terrain_shade`, which the effect supplies as "terrain-shade.wgsl",
// as the sprite batcher's `sprite_shade` is; it may declare bindings in group 2. The view in group
// 0 is the batcher's, so one view drives both.

struct View {
  view_proj: mat4x4f,
  eye: vec4f,
  right: vec4f,
  up: vec4f,
  // x: seconds, y: sampling mode (unused here: terrain is always sharp), z: alpha cut, w: unused.
  misc: vec4f,
}

struct Box {
  // xy: north-west corner (x, z); zw: size.
  origin: vec4f,
  // Heights of the top at the corners: north-west, north-east, south-east, south-west.
  top: vec4f,
  // How far each side runs down: n, e, s, w.
  bottom: vec4f,
  // x: top layer, y: side layer, z: flags (RIM_*), w: unused.
  art: vec4f,
  // The top layer of each neighbour to dither with (n, e, s, w), or −1.
  blend: vec4f,
}

struct TerrainSettings {
  // x: dither width in texels, y: rim strength, z: rim width in texels, w: unused.
  edges: vec4f,
}

@group(0) @binding(0) var<uniform> view: View;
@group(1) @binding(0) var<storage, read> boxes: array<Box>;
@group(1) @binding(1) var art: texture_2d_array<f32>;
@group(1) @binding(2) var art_linear: sampler;
// The size in texels of each layer's image (xy), since layers are padded to the largest.
@group(1) @binding(3) var<storage, read> layer_sizes: array<vec4f>;
@group(1) @binding(4) var<uniform> settings: TerrainSettings;

const TEXELS_PER_UNIT = 16.0;
const FACE_TOP = 0u;
const FACE_N = 1u;
const FACE_E = 2u;
const FACE_S = 3u;
const FACE_W = 4u;

/** What a shade chunk gets for each terrain fragment. */
struct TerrainFragment {
  color: vec3f,
  world: vec3f,
  normal: vec3f,
  // Position in texels of the art, before wrapping: continuous across the scene.
  texel: vec2f,
  layer: i32,
  // FACE_TOP or one of the sides.
  face: u32,
  // 0..1: how close to a rim (a top's edge above a drop), for shading that wants it.
  rim: f32,
}

#include "terrain-shade.wgsl"

struct TerrainVarying {
  @builtin(position) position: vec4f,
  @location(0) world: vec3f,
  @location(1) texel: vec2f,
  @location(2) normal: vec3f,
  @location(3) @interpolate(flat) index: u32,
  @location(4) @interpolate(flat) face: u32,
}

// Corners of a face quad, as (along, up) pairs, in two triangles.
const QUAD = array<vec2f, 6>(
  vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
  vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0),
);

@vertex fn vs_terrain(
  @builtin(vertex_index) vertex: u32,
  @builtin(instance_index) instance: u32,
) -> TerrainVarying {
  let box = boxes[instance];
  let face = vertex / 6u;
  let q = QUAD[vertex % 6u];
  let x0 = box.origin.x;
  let z0 = box.origin.y;
  let x1 = x0 + box.origin.z;
  let z1 = z0 + box.origin.w;
  // Corners nw, ne, se, sw.
  let c = array<vec2f, 4>(vec2f(x0, z0), vec2f(x1, z0), vec2f(x1, z1), vec2f(x0, z1));
  let h = array<f32, 4>(box.top.x, box.top.y, box.top.z, box.top.w);

  var world: vec3f;
  var texel: vec2f;
  var normal: vec3f;
  if (face == FACE_TOP) {
    // nw → ne → se, nw → se → sw, written as a bilinear patch; slopes tilt along one axis, so
    // the two triangles stay in one plane.
    let xz = mix(mix(c[0], c[1], q.x), mix(c[3], c[2], q.x), q.y);
    let y = mix(mix(h[0], h[1], q.x), mix(h[3], h[2], q.x), q.y);
    world = vec3f(xz.x, y, xz.y);
    texel = xz * TEXELS_PER_UNIT;
    let along_x = vec3f(x1 - x0, ((h[1] - h[0]) + (h[2] - h[3])) * 0.5, 0.0);
    let along_z = vec3f(0.0, ((h[3] - h[0]) + (h[2] - h[1])) * 0.5, z1 - z0);
    normal = normalize(cross(along_z, along_x));
  } else {
    // A side runs along an edge from corner a to corner b, seen from outside.
    var a: u32;
    var b: u32;
    var bottom: f32;
    switch face {
      case FACE_N: { a = 1u; b = 0u; bottom = box.bottom.x; normal = vec3f(0.0, 0.0, -1.0); }
      case FACE_E: { a = 2u; b = 1u; bottom = box.bottom.y; normal = vec3f(1.0, 0.0, 0.0); }
      case FACE_S: { a = 3u; b = 2u; bottom = box.bottom.z; normal = vec3f(0.0, 0.0, 1.0); }
      default: { a = 0u; b = 3u; bottom = box.bottom.w; normal = vec3f(-1.0, 0.0, 0.0); }
    }
    let xz = mix(c[a], c[b], q.x);
    let top = mix(h[a], h[b], q.x);
    // Never above the top, so a face whose neighbour is as high collapses to a line.
    let low = min(bottom, top);
    let y = mix(low, top, q.y);
    world = vec3f(xz.x, y, xz.y);
    // Along the edge in world units, so walls continue round corners; down from the top edge.
    let along = select(xz.x, xz.y, face == FACE_E || face == FACE_W);
    texel = vec2f(along, top - y) * TEXELS_PER_UNIT;
  }

  var out: TerrainVarying;
  out.position = view.view_proj * vec4f(world, 1.0);
  out.world = world;
  out.texel = texel;
  out.normal = normal;
  out.index = instance;
  out.face = face;
  return out;
}

// Sharp sampling (sampling.wgsl) of a repeating image: the texel is wrapped into the layer's own
// size after the edge is found, and kept half a texel inside it, so the sampler never blends in
// the padding that fills a smaller image's layer. Where the image repeats the edge is hard.
fn sample_tiled(texel: vec2f, footprint: vec2f, layer: i32) -> vec4f {
  let size = layer_sizes[layer].xy;
  let edge = floor(texel + 0.5);
  let offset = clamp((texel - edge) / max(footprint, vec2f(1e-4)), vec2f(-0.5), vec2f(0.5));
  let wrapped = (edge + offset) - floor((edge + offset) / size) * size;
  let at = clamp(wrapped, vec2f(0.5), size - 0.5);
  return textureSampleLevel(art, art_linear, at / vec2f(textureDimensions(art).xy), layer, 0.0);
}

// A stable random number per texel, for the dithered seams.
fn texel_hash(p: vec2f) -> f32 {
  let q = vec2u(vec2i(p) + vec2i(65536));
  var h = (q.x * 0x27d4eb2du) ^ (q.y * 0x165667b1u);
  h = (h ^ (h >> 15u)) * 0x2c1b3c6du;
  h = h ^ (h >> 12u);
  return f32(h & 0xffffu) / 65535.0;
}

// Derivatives first, while control flow is uniform.
@fragment fn fs_terrain(in: TerrainVarying) -> @location(0) vec4f {
  let footprint = fwidth(in.texel);
  let box = boxes[in.index];
  var layer = i32(box.art.y);
  var rim = 0.0;
  if (in.face == FACE_TOP) {
    layer = i32(box.art.x);
    // Whole texels from each edge of the box, north, east, south, west.
    let cell = floor(in.texel) + 0.5;
    let lo = box.origin.xy * TEXELS_PER_UNIT;
    let hi = (box.origin.xy + box.origin.zw) * TEXELS_PER_UNIT;
    let d = array<f32, 4>(cell.y - lo.y, hi.x - cell.x, hi.y - cell.y, cell.x - lo.x);
    let others = array<f32, 4>(box.blend.x, box.blend.y, box.blend.z, box.blend.w);
    let width = settings.edges.x;
    let r = texel_hash(cell);
    let flags = u32(box.art.z);
    for (var i = 0u; i < 4u; i++) {
      // Both sides of a seam give way to the other with a chance that falls from a half at the
      // edge to nothing `width` texels in, so the boundary frays the same way from either side.
      if (others[i] >= 0.0 && width > 0.0) {
        let chance = 0.5 * (1.0 - clamp(d[i] / width, 0.0, 1.0));
        if (r < chance) {
          layer = i32(others[i]);
        }
      }
      if ((flags & (1u << i)) != 0u) {
        rim = max(rim, 1.0 - clamp(d[i] / max(settings.edges.z, 1.0), 0.0, 1.0));
      }
    }
  }
  let color = sample_tiled(in.texel, footprint, layer).rgb;
  var fragment: TerrainFragment;
  fragment.color = color;
  fragment.world = in.world;
  fragment.normal = in.normal;
  fragment.texel = in.texel;
  fragment.layer = layer;
  fragment.face = in.face;
  fragment.rim = rim * settings.edges.y;
  return vec4f(terrain_shade(fragment), 1.0);
}

@fragment fn fs_depth() {}
