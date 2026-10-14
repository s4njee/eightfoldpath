// Pixel quads (story 3.10): screen-aligned rectangles that copy texels from a texture array at a
// whole-number scale. Each quad maps `scale` x `scale` screen pixels to one texel, wrapping inside
// its source rectangle, so the same pipeline draws glyphs, nine-slice frames (edges and centre
// tile instead of stretching) and tiled backdrops. Texels with alpha 0 are discarded, so quads
// drawn later cover earlier ones without blending.

#include "params.wgsl"

struct Quad {
  // Destination in target pixels: x, y (top-left), width, height.
  dst: vec4f,
  // Source in texels: x, y, width, height.
  src: vec4f,
  // Linear colour multiplier and the typewriter order (negative: always shown).
  tint: vec4f,
  // Texture layer, pixels per texel, and an id for the debug view.
  extra: vec4f,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> quads: array<Quad>;
@group(0) @binding(2) var art: texture_2d_array<f32>;

struct Varying {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(flat) quad: u32,
}

@vertex fn vs(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> Varying {
  let q = quads[instance];
  var out: Varying;
  out.quad = instance;
  // A glyph the typewriter has not reached yet collapses to nothing.
  if (q.tint.w >= 0.0 && q.tint.w >= params.reveal) {
    out.position = vec4f(0.0, 0.0, 0.0, 0.0);
    return out;
  }
  let corner = vec2f(f32((0x32u >> vertex) & 1u), f32((0x2cu >> vertex) & 1u));
  let pixel = q.dst.xy + corner * q.dst.zw;
  let ndc = pixel / params.viewport * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0);
  out.position = vec4f(ndc, 0.0, 1.0);
  return out;
}

fn debug_hue(id: f32) -> vec3f {
  let h = fract(id * 0.618034);
  return clamp(abs(fract(vec3f(h) + vec3f(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, vec3f(0.0), vec3f(1.0));
}

@fragment fn fs(in: Varying) -> @location(0) vec4f {
  let q = quads[in.quad];
  if (params.debug > 0.5) {
    return vec4f(debug_hue(q.extra.z) * 0.8 + 0.1, 1.0);
  }
  // Which texel of the source this pixel is, wrapping inside the source rectangle.
  let local = floor((in.position.xy - q.dst.xy) / q.extra.y);
  let texel = q.src.xy + local - floor(local / q.src.zw) * q.src.zw;
  let colour = textureLoad(art, vec2u(texel), u32(q.extra.x), 0);
  if (colour.a < 0.5) {
    discard;
  }
  return vec4f(colour.rgb * q.tint.rgb, 1.0);
}
