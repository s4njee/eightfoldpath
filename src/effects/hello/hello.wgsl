#include "params.wgsl"

// One lit sprite standing on one tile. Every quad (the ground, the sprite, the light's glow) is an
// entry in `quads`; the vertex stage builds its six corners from the vertex index.

struct Quad {
  // xyz: centre (ground), feet (sprite) or position (glow); w: kind, see KIND_*.
  center: vec4f,
  // xy: size in world units; z: texture array layer.
  size: vec4f,
  // xy: the part of the layer to show, as a UV scale from its origin.
  uv: vec4f,
}

const KIND_GROUND = 0.0;
const KIND_SPRITE = 1.0;

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var pixel_sampler: sampler;
@group(0) @binding(2) var art: texture_2d_array<f32>;
@group(0) @binding(3) var<storage, read> quads: array<Quad>;

struct Varying {
  @builtin(position) position: vec4f,
  @location(0) world: vec3f,
  @location(1) uv: vec2f,
  @location(2) @interpolate(flat) layer: i32,
  @location(3) @interpolate(flat) kind: f32,
}

const CORNERS = array<vec2f, 6>(
  vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
  vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0),
);

@vertex fn vs(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> Varying {
  let quad = quads[instance];
  let corner = CORNERS[vertex];
  let kind = quad.center.w;
  var world: vec3f;
  if (kind == KIND_GROUND) {
    // Flat on the ground plane, centred.
    world = quad.center.xyz + vec3f((corner.x - 0.5) * quad.size.x, 0.0, (corner.y - 0.5) * quad.size.y);
  } else if (kind == KIND_SPRITE) {
    // A billboard locked to the vertical axis, standing on its feet: it turns to face the camera
    // but never leans back, so it stays upright as the camera looks down on it.
    world = quad.center.xyz + params.camera_right * (corner.x - 0.5) * quad.size.x
      + vec3f(0.0, corner.y * quad.size.y, 0.0);
  } else {
    // The light's glow: a billboard that fully faces the camera.
    world = quad.center.xyz + params.camera_right * (corner.x - 0.5) * quad.size.x
      + params.camera_up * (corner.y - 0.5) * quad.size.y;
  }
  var out: Varying;
  out.position = params.view_proj * vec4f(world, 1.0);
  out.world = world;
  // Image rows run top to bottom, so v is flipped for anything that stands up.
  let v = select(1.0 - corner.y, corner.y, kind == KIND_GROUND);
  out.uv = vec2f(corner.x, v) * quad.uv.xy;
  out.layer = i32(quad.size.z);
  out.kind = kind;
  return out;
}

// Light arriving at a point, before the surface's response: colour × intensity, softened inverse
// square so the light never blows up when it passes close.
fn light_at(world: vec3f) -> vec3f {
  let d = params.light_pos - world;
  return params.light_color * params.light_intensity / (1.0 + dot(d, d));
}

// A soft contact shadow under the sprite's feet. A stand-in until story 3.4 compares real
// sprite shadows; it does not move with the light.
fn contact_shadow(world: vec3f) -> f32 {
  let d = length((world.xz - params.sprite_feet.xz) / vec2f(0.8, 0.5));
  return mix(params.shadow, 1.0, smoothstep(0.55, 1.0, d));
}

@fragment fn fs_lit(in: Varying) -> @location(0) vec4f {
  let texel = textureSample(art, pixel_sampler, in.uv, in.layer);
  // Alpha is exactly 0 or 1 in the cleaned art, so a hard cut loses nothing. Anti-aliased
  // cutouts (alpha-to-coverage) need MSAA and are story 3.2.
  if (texel.a < 0.5) {
    discard;
  }
  let to_light = normalize(params.light_pos - in.world);
  var lit: vec3f;
  if (in.kind == KIND_GROUND) {
    let diffuse = max(to_light.y, 0.0);
    let shadow = contact_shadow(in.world);
    lit = params.ambient * mix(1.0, shadow, 0.6) + light_at(in.world) * diffuse * shadow;
  } else {
    // A flat sprite has no real normal. Treat it as facing the camera, tilted up a little, and
    // wrap the falloff so its unlit side is dim rather than black. Story 3.3 does this properly.
    let facing = normalize(vec3f(params.camera_pos.x - in.world.x, 0.0, params.camera_pos.z - in.world.z));
    let normal = normalize(facing + vec3f(0.0, 0.35, 0.0));
    let wrapped = clamp((dot(normal, to_light) + 0.5) / 1.5, 0.0, 1.0);
    lit = params.ambient + light_at(in.world) * wrapped;
  }
  return vec4f(texel.rgb * lit, 1.0);
}

// Added on top of the scene, above SDR white, so the tail's bloom picks it up.
@fragment fn fs_glow(in: Varying) -> @location(0) vec4f {
  let p = in.uv * 2.0 - 1.0;
  let falloff = exp(-dot(p, p) * 5.0);
  return vec4f(params.light_color * params.glow * falloff, 0.0);
}
