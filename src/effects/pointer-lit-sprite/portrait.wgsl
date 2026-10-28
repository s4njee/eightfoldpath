// Pointer-lit sprite (story 9.2): one fullscreen pass that draws a pixel-art portrait on a round
// backdrop and lights both with one point light.
//
// Everything is worked out in the sprite's own texels: x right, y down the image (as the canvas),
// with the light and the surfaces lifted into 3D as (x, -y, z) so z points at the viewer and the
// normal maps (x right, y up, z out) apply as stored. The sprite is the plane z = 0; the backdrop
// is a plane `backdrop_depth` texels behind it, which is what lets the sprite cast a shadow on it.

#include "fullscreen.wgsl"
#include "palette.wgsl"
#include "sampling.wgsl"
#include "sprite-light-common.wgsl"
#include "params.wgsl"

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var art: texture_2d_array<f32>;
@group(0) @binding(2) var normals: texture_2d_array<f32>;
@group(0) @binding(3) var art_sampler: sampler;
@group(0) @binding(4) var lut: texture_3d<f32>;
@group(0) @binding(5) var shade_table: texture_2d<f32>;

const VIEW_ALBEDO = 1.0;
const VIEW_NORMALS = 2.0;
const VIEW_LIGHTING = 3.0;
// The light level of shade_table's last column (MAX_GAIN in shade-table.ts).
const MAX_GAIN = 2.0;

fn in_sprite(texel: vec2f) -> bool {
  return all(texel >= vec2f(0.0)) && all(texel < params.sprite_size);
}

fn sprite_alpha_at(texel: vec2f) -> f32 {
  if (!in_sprite(texel)) {
    return 0.0;
  }
  return textureLoad(art, vec2i(floor(texel)), i32(params.layer), 0).a;
}

// Light in flat steps, as a pixel artist shades; `bands` is 0 for smooth light.
fn band(x: f32) -> f32 {
  return sprite_light_bands(x, params.bands);
}

// Palette shading: the albedo's palette index (story 3.5's lookup table keeps it in alpha) picks a
// row of shade_table and the light level a column, so the lit colour is a step of that colour's
// own ramp of palette colours. The light's hue is given up for the ramp's, which leans cool in the
// shadows and warm in the highlights as an artist's would.
fn ramp_shade(albedo: vec3f, lit: vec3f) -> vec3f {
  let index = u32(round(palette_lut_lookup(lut, albedo).a * 255.0));
  let levels = textureDimensions(shade_table).x;
  let column = u32(round(clamp(luminance(lit) / MAX_GAIN, 0.0, 1.0) * f32(levels - 1u)));
  return textureLoad(shade_table, vec2u(column, index), 0).rgb;
}

// The finished colour of one surface: albedo under ambient, the light and the rim.
fn shade(albedo: vec3f, diffuse: f32, rim: f32) -> vec3f {
  let lit = params.ambient + params.light_color * band(diffuse) * params.light_on;
  let kick = params.rim_color * band(rim);
  if (params.view == VIEW_LIGHTING) {
    return lit + kick;
  }
  if (params.palette_on > 0.5) {
    let colour = ramp_shade(albedo, lit);
    if (rim <= 0.0) {
      return colour;
    }
    // The rim is a second, coloured light; where it lands, the nearest palette colour.
    return palette_lut_lookup(lut, colour + kick * (colour + 0.15)).rgb;
  }
  // The rim keeps a little of its own colour, so it reads on dark cloth and hair.
  return albedo * lit + kick * (albedo + 0.15);
}

@fragment fn fs(in: FullscreenVarying) -> @location(0) vec4f {
  let pixel = in.position.xy;
  let texel = (pixel - params.origin) / params.scale;
  let light = vec3f(params.light.x, -params.light.y, params.light.z);

  // Coverage of the disc, antialiased over one pixel; everything outside it stays transparent.
  let framed = params.backdrop_on > 0.5;
  let disc = select(0.0, clamp(params.disc.z - distance(pixel, params.disc.xy) + 0.5, 0.0, 1.0), framed);

  // The sprite, read with story 3.1's sharp filter so its texels stay square at any scale, and
  // clipped to the disc as an avatar would be.
  var art_colour = vec4f(0.0);
  if (in_sprite(texel)) {
    art_colour = sample_sharp(art, art_sampler, texel, vec2f(1.0 / params.scale), i32(params.layer));
  }
  let alpha = art_colour.a * select(1.0, disc, framed);
  if (alpha <= 0.0 && disc <= 0.0) {
    return vec4f(0.0);
  }

  // Sprite: its automatic normal, the point light and a rim from the side away from the light.
  var sprite = vec3f(0.0);
  if (alpha > 0.0) {
    let at = clamp(vec2i(floor(texel)), vec2i(0), vec2i(params.sprite_size) - 1);
    let n = normalize(textureLoad(normals, at, i32(params.layer), 0).rgb * 2.0 - 1.0);
    let surface = vec3f(texel.x, -texel.y, 0.0);
    let diffuse = sprite_light_point(surface, n, light, params.range) * params.intensity;
    let rim = sprite_light_rim(n, vec3f(0.0, 0.0, 1.0), params.rim_direction, params.rim_power) *
      params.rim_strength;
    // Straight alpha: transparent texels carry their neighbours' colour (bleedColour), so the
    // sharp filter's blend at the silhouette does not darken it.
    let albedo = art_colour.rgb;
    if (params.view == VIEW_ALBEDO) {
      sprite = albedo;
    } else if (params.view == VIEW_NORMALS) {
      sprite = srgb_to_linear(n * 0.5 + 0.5);
    } else {
      sprite = shade(albedo, diffuse, rim);
    }
  }

  // Backdrop: a flat plane behind the sprite. The sprite's shadow on it is where the ray from the
  // backdrop to the light crosses the sprite's plane over an opaque texel: one texel read.
  var backdrop = vec3f(0.0);
  if (disc > 0.0 && alpha < 1.0) {
    let surface = vec3f(texel.x, -texel.y, -params.backdrop_depth);
    var lit = sprite_light_point(surface, vec3f(0.0, 0.0, 1.0), light, params.range) * params.intensity;
    if (params.shadow_on > 0.5 && light.z > 0.0) {
      let t = params.backdrop_depth / (light.z + params.backdrop_depth);
      let hit = surface + (light - surface) * t;
      lit *= 1.0 - params.shadow_strength * step(0.5, sprite_alpha_at(vec2f(hit.x, -hit.y)));
    }
    if (params.view == VIEW_ALBEDO) {
      backdrop = params.backdrop_color;
    } else if (params.view == VIEW_NORMALS) {
      backdrop = srgb_to_linear(vec3f(0.5, 0.5, 1.0));
    } else {
      backdrop = shade(params.backdrop_color, lit, 0.0);
    }
  }

  // Premultiplied: the sprite over the backdrop, the backdrop over nothing.
  let behind = disc * (1.0 - alpha);
  return vec4f(sprite * alpha + backdrop * behind, alpha + behind);
}
