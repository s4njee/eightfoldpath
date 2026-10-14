// Textured terrain blocks for the outlines scene: a top and four sides per box, instanced.
//
// The sprite batcher has no fixed vertical walls, and the outline story needs them: a block's
// top and front meet at a crease where depth is continuous and the object is the same, so only
// the normal test can find it. Like the sprites, a block draws either colour or the outline
// G-buffer (src/wgsl/outline-sprite.wgsl has the layout), chosen by `blocks.mode.x`.

struct Blocks {
  view_proj: mat4x4f,
  right: vec4f,
  up: vec4f,
  // x: 1 draws the outline G-buffer instead of colour.
  mode: vec4f,
}

struct Block {
  // xyz: lower corner; w: texture layer of the top.
  lo: vec4f,
  // xyz: upper corner; w: texture layer of the sides.
  hi: vec4f,
  // Texel size of the top image (xy) and the side image (zw), for wrapping.
  sizes: vec4f,
}

@group(0) @binding(0) var<uniform> blocks: Blocks;
@group(0) @binding(1) var<storage, read> boxes: array<Block>;
@group(0) @binding(2) var art: texture_2d_array<f32>;

const TEXELS_PER_UNIT = 16.0;
const TERRAIN_ID = 1.0;

// Top, then the sides facing +z, +x, -z and -x.
const NORMALS = array<vec3f, 5>(
  vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0),
  vec3f(0.0, 0.0, -1.0), vec3f(-1.0, 0.0, 0.0),
);
// Baked face shading, the way hand-made pixel-art terrain does it: lit top, darker walls. Without
// it the top and the front of a block in the same texture would be one flat colour.
const SHADE = array<f32, 5>(1.0, 0.72, 0.58, 0.5, 0.6);

const CORNERS = array<vec2f, 6>(
  vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
  vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0),
);

struct BlockVarying {
  @builtin(position) position: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) face: u32,
  @location(2) @interpolate(flat) index: u32,
}

@vertex fn vs_block(
  @builtin(vertex_index) vertex: u32,
  @builtin(instance_index) instance: u32,
) -> BlockVarying {
  let box = boxes[instance];
  let lo = box.lo.xyz;
  let hi = box.hi.xyz;
  let face = vertex / 6u;
  let c = CORNERS[vertex % 6u];
  var world: vec3f;
  switch (face) {
    case 0u: { world = vec3f(mix(lo.x, hi.x, c.x), hi.y, mix(hi.z, lo.z, c.y)); }
    case 1u: { world = vec3f(mix(lo.x, hi.x, c.x), mix(lo.y, hi.y, c.y), hi.z); }
    case 2u: { world = vec3f(hi.x, mix(lo.y, hi.y, c.y), mix(hi.z, lo.z, c.x)); }
    case 3u: { world = vec3f(mix(hi.x, lo.x, c.x), mix(lo.y, hi.y, c.y), lo.z); }
    default: { world = vec3f(lo.x, mix(lo.y, hi.y, c.y), mix(lo.z, hi.z, c.x)); }
  }
  var out: BlockVarying;
  out.position = blocks.view_proj * vec4f(world, 1.0);
  out.world = world;
  out.face = face;
  out.index = instance;
  return out;
}

@fragment fn fs_block(in: BlockVarying) -> @location(0) vec4f {
  let normal = NORMALS[in.face];
  if (blocks.mode.x > 0.5) {
    return vec4f(dot(normal, blocks.right.xyz), dot(normal, blocks.up.xyz), TERRAIN_ID, 1.0);
  }
  let box = boxes[in.index];
  // Texels at the shared density (16 a unit), nearest, wrapped over the image. Sides read the
  // image from its top row down from the block's top edge, so a cliff's grassy lip sits at the top.
  var texel: vec2f;
  var size: vec2f;
  var layer: i32;
  if (in.face == 0u) {
    texel = in.world.xz * TEXELS_PER_UNIT;
    size = box.sizes.xy;
    layer = i32(box.lo.w);
  } else {
    let along = select(in.world.z, in.world.x, in.face == 1u || in.face == 3u);
    texel = vec2f(along, box.hi.y - in.world.y) * TEXELS_PER_UNIT;
    size = box.sizes.zw;
    layer = i32(box.hi.w);
  }
  let wrapped = min(vec2i(floor(texel - size * floor(texel / size))), vec2i(size) - 1);
  let colour = textureLoad(art, wrapped, layer, 0).rgb;
  return vec4f(colour * SHADE[in.face], 1.0);
}
