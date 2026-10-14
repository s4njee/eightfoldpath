// The sprite batcher (story 3.2): every sprite in one instanced draw.
//
// Each sprite is a quad built in the vertex stage from the instance's entry in `sprites`. Art comes
// from one texture array, read with sampling.wgsl. The colour a sprite ends up with is decided by
// `sprite_shade`, which the effect supplies as the run-time chunk "sprite-shade.wgsl": unlit by
// default, lit by story 3.3, and so on. A shade chunk may declare its own bindings in group 2.

#include "sampling.wgsl"

struct View {
  view_proj: mat4x4f,
  // xyz: eye position (for a directional light camera, any point far back along the light).
  eye: vec4f,
  // xyz: camera right and up in world space.
  right: vec4f,
  up: vec4f,
  // x: seconds, y: sampling mode (sampling.wgsl), z: alpha cut-off, w: unused.
  misc: vec4f,
}

struct Sprite {
  // xyz: feet (upright and camera-facing) or centre (ground); w: facing, see FACING_*.
  position: vec4f,
  // xy: world size; z: texture array layer; w: flags, see FLAG_*.
  size: vec4f,
  // The first frame's rectangle in texels: x, y, width, height.
  region: vec4f,
  // x: frame count (laid out left to right), y: frames per second, z: start time, w: first frame.
  anim: vec4f,
  // rgb: tint multiplier; a: hit flash, 0..1 toward white.
  tint: vec4f,
}

const FACING_UPRIGHT = 0.0;
const FACING_CAMERA = 1.0;
const FACING_GROUND = 2.0;
const FLAG_FLIP_X = 1u;

@group(0) @binding(0) var<uniform> view: View;
@group(1) @binding(0) var<storage, read> sprites: array<Sprite>;
@group(1) @binding(1) var art: texture_2d_array<f32>;
@group(1) @binding(2) var art_linear: sampler;
// Same layout as `art`, one layer per art layer; 1×1 flat normals when the effect gave none.
@group(1) @binding(3) var normal_map: texture_2d_array<f32>;

struct SpriteVarying {
  @builtin(position) position: vec4f,
  // In texels of the layer, so sampling and lighting can work on the pixel-art grid.
  @location(0) texel: vec2f,
  @location(1) world: vec3f,
  @location(2) normal: vec3f,
  // 0..1 across the frame, y up.
  @location(3) uv: vec2f,
  @location(4) @interpolate(flat) layer: i32,
  @location(5) @interpolate(flat) index: u32,
  @location(6) @interpolate(flat) tint: vec4f,
  @location(7) @interpolate(flat) facing: f32,
  @location(8) @interpolate(flat) flags: u32,
}

/** What a shade chunk gets for each fragment that survived the alpha test. */
struct SpriteFragment {
  color: vec4f,
  texel: vec2f,
  texel_footprint: vec2f,
  world: vec3f,
  normal: vec3f,
  uv: vec2f,
  layer: i32,
  index: u32,
  // FACING_UPRIGHT, FACING_CAMERA or FACING_GROUND.
  facing: f32,
  // The sprite is mirrored, so a normal map's x must be mirrored too.
  flip_x: bool,
}

#include "sprite-shade.wgsl"

const CORNERS = array<vec2f, 6>(
  vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
  vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0),
);

fn frame_index(sprite: Sprite) -> f32 {
  let frames = max(sprite.anim.x, 1.0);
  let elapsed = max(view.misc.x - sprite.anim.z, 0.0);
  return (floor(elapsed * sprite.anim.y) + sprite.anim.w) % frames;
}

@vertex fn vs_sprite(
  @builtin(vertex_index) vertex: u32,
  @builtin(instance_index) instance: u32,
) -> SpriteVarying {
  let sprite = sprites[instance];
  let corner = CORNERS[vertex];
  let facing = sprite.position.w;
  let size = sprite.size.xy;
  var world: vec3f;
  var normal: vec3f;
  if (facing == FACING_GROUND) {
    world = sprite.position.xyz + vec3f((corner.x - 0.5) * size.x, 0.0, (0.5 - corner.y) * size.y);
    normal = vec3f(0.0, 1.0, 0.0);
  } else if (facing == FACING_CAMERA) {
    world = sprite.position.xyz + view.right.xyz * (corner.x - 0.5) * size.x
      + view.up.xyz * corner.y * size.y;
    normal = normalize(cross(view.right.xyz, view.up.xyz));
  } else {
    // Turns about the vertical axis to face the camera, but never leans back: upright as the
    // camera looks down, which is how sprites stand in a diorama.
    let right = normalize(vec3f(view.right.x, 0.0, view.right.z));
    world = sprite.position.xyz + right * (corner.x - 0.5) * size.x
      + vec3f(0.0, corner.y * size.y, 0.0);
    // Horizontal, toward the camera: the right vector turned a quarter turn about +y.
    normal = vec3f(-right.z, 0.0, right.x);
  }

  // Texel coordinates in the layer: the frame's rectangle, shifted along the strip by the frame
  // index, flipped if asked, with y running down the image.
  let flags = u32(sprite.size.w);
  var u = corner.x;
  if ((flags & FLAG_FLIP_X) != 0u) {
    u = 1.0 - u;
  }
  let region = sprite.region;
  let frame = frame_index(sprite);
  var out: SpriteVarying;
  out.position = view.view_proj * vec4f(world, 1.0);
  out.texel = vec2f(region.x + (frame + u) * region.z, region.y + (1.0 - corner.y) * region.w);
  out.world = world;
  out.normal = normal;
  out.uv = vec2f(u, corner.y);
  out.layer = i32(sprite.size.z);
  out.index = instance;
  out.tint = sprite.tint;
  out.facing = facing;
  out.flags = flags;
  return out;
}

// Derivatives are taken first, while control flow is still uniform.
@fragment fn fs_sprite(in: SpriteVarying) -> @location(0) vec4f {
  let footprint = fwidth(in.texel);
  let color = sample_pixel_art(u32(view.misc.y), art, art_linear, in.texel, footprint, in.layer);
  if (color.a < view.misc.z) {
    discard;
  }
  var fragment: SpriteFragment;
  fragment.color = color;
  fragment.texel = in.texel;
  fragment.texel_footprint = footprint;
  fragment.world = in.world;
  fragment.normal = in.normal;
  fragment.uv = in.uv;
  fragment.layer = in.layer;
  fragment.index = in.index;
  fragment.facing = in.facing;
  fragment.flip_x = (in.flags & FLAG_FLIP_X) != 0u;
  let shaded = sprite_shade(fragment) * in.tint.rgb;
  // The hit flash pushes toward white after shading, so it reads even in shadow.
  return vec4f(mix(shaded, vec3f(1.0), in.tint.a), color.a);
}

// Depth only, for shadow maps (story 3.4): the same quads and the same cut-out, no colour.
@fragment fn fs_depth(in: SpriteVarying) {
  let footprint = fwidth(in.texel);
  let color = sample_pixel_art(u32(view.misc.y), art, art_linear, in.texel, footprint, in.layer);
  if (color.a < 0.5) {
    discard;
  }
}
