// Palette mapping (story 3.5). Two fullscreen passes:
//
//   fs_source  draws the input at the pixel-art resolution (canvas / block) into an rgba16float
//              target: a painted illustration, minified through its mips, or a small lit scene.
//              Alpha 1 means "map me"; alpha 0 means the colour is already a palette colour (the
//              ramp-shaded spheres), so the mapping leaves it alone.
//   fs_map     runs at canvas resolution: each block of pixels reads its source texel, adds the
//              dither threshold for the block, and looks up the nearest palette colour.

#include "fullscreen.wgsl"
#include "palette.wgsl"
#include "params.wgsl"

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var lut: texture_3d<f32>;
@group(0) @binding(2) var palette: texture_2d<f32>;
@group(0) @binding(3) var ramps: texture_2d<f32>;
@group(0) @binding(4) var blue_noise: texture_2d<f32>;
@group(0) @binding(5) var picture: texture_2d<f32>;
@group(0) @binding(6) var picture_sampler: sampler;
@group(1) @binding(0) var source: texture_2d<f32>;

const VIEW_ERROR = 1.0;
const VIEW_THRESHOLD = 2.0;
const VIEW_LUT = 3.0;

// ---- input ------------------------------------------------------------------------------------

struct Sphere {
  centre: vec2f,
  radius: f32,
  ramp: u32,
}

fn sphere(i: u32) -> Sphere {
  // Four spheres in a row, standing on the horizon line; ramp rows match index.ts's RAMP_BASES.
  let x = (f32(i) - 1.5) * 0.36;
  return Sphere(vec2f(x, 0.12 - 0.02 * f32(i % 2u)), 0.15, i);
}

fn albedo(i: u32) -> vec3f {
  // The middle step of each ramp, so the two shading modes start from the same colour.
  let steps = textureDimensions(ramps).x;
  return textureLoad(ramps, vec2u(steps / 2u, i), 0).rgb;
}

fn lit_scene(pixel: vec2f) -> vec4f {
  // y up, the frame's height spanning -0.5..0.5, x scaled by the aspect.
  let p = vec2f(pixel.x - params.source_size.x * 0.5, params.source_size.y * 0.5 - pixel.y) /
    params.source_size.y;
  let horizon = 0.0;
  // A dusk sky and a dark meadow: smooth gradients, the hardest thing for a palette to hold.
  var colour = select(
    mix(vec3f(0.30, 0.12, 0.06), vec3f(0.015, 0.02, 0.07), smoothstep(0.0, 0.5, p.y)),
    mix(vec3f(0.035, 0.07, 0.03), vec3f(0.006, 0.012, 0.01), smoothstep(0.0, -0.5, p.y)),
    p.y < horizon,
  );
  // The warm glow of the light on the ground and the sky around it.
  let light = params.light;
  let glow = exp(-8.0 * dot(p - light.xy, p - light.xy));
  colour += vec3f(0.5, 0.32, 0.14) * glow * 0.6;

  for (var i = 0u; i < 4u; i++) {
    let s = sphere(i);
    let d = (p - s.centre) / s.radius;
    let r2 = dot(d, d);
    // A soft contact shadow on the ground under each sphere.
    let below = (p - (s.centre - vec2f(0.0, s.radius * 0.9))) / vec2f(s.radius * 1.2, s.radius * 0.3);
    if (p.y < s.centre.y - s.radius * 0.6) {
      colour *= mix(1.0, 0.45, exp(-2.0 * dot(below, below)));
    }
    if (r2 > 1.0) {
      continue;
    }
    let normal = vec3f(d, sqrt(1.0 - r2));
    let surface = vec3f(p, normal.z * s.radius);
    let to_light = light - surface;
    let l = normalize(to_light);
    let falloff = 1.0 / (1.0 + 2.0 * dot(to_light, to_light));
    let diffuse = max(dot(normal, l), 0.0) * falloff;
    let specular = pow(max(dot(reflect(-l, normal), vec3f(0.0, 0.0, 1.0)), 0.0), 24.0) * falloff;
    if (params.shading > 0.5) {
      // Ramp shading: the light level picks a step of the material's ramp, so every pixel is
      // already one of the artist's colours and the dither has nothing to do.
      let level = 0.12 + 1.1 * diffuse + 0.6 * specular;
      return vec4f(palette_ramp(ramps, s.ramp, level), 0.0);
    }
    let ambient = vec3f(0.05, 0.06, 0.11);
    let light_colour = vec3f(1.6, 1.25, 0.85);
    return vec4f(albedo(s.ramp) * (ambient + light_colour * diffuse) + light_colour * specular * 0.6, 1.0);
  }
  return vec4f(colour, 1.0);
}

@fragment fn fs_source(in: FullscreenVarying) -> @location(0) vec4f {
  if (params.input > 0.5) {
    return lit_scene(in.position.xy);
  }
  let uv = params.cover.xy + in.position.xy / params.source_size * params.cover.zw;
  return vec4f(textureSampleLevel(picture, picture_sampler, uv, params.lod).rgb, 1.0);
}

// ---- mapping ----------------------------------------------------------------------------------

fn threshold(block: vec2u) -> f32 {
  if (params.dither > 1.5) {
    return palette_blue_noise(blue_noise, block);
  }
  if (params.dither > 0.5) {
    return palette_bayer8(block);
  }
  return 0.5;
}

// Black, red, yellow, white: how far each pixel moved to reach the palette.
fn heat(t: f32) -> vec3f {
  let x = clamp(t, 0.0, 1.0) * 3.0;
  return clamp(vec3f(x, x - 1.0, x - 2.0), vec3f(0.0), vec3f(1.0));
}

// The 32 blue slices of the table side by side, 8 across and 4 down, red across and green down.
fn lut_view(pixel: vec2f) -> vec3f {
  let n = textureDimensions(lut).x;
  let grid = vec2f(f32(n) * 8.0, f32(n) * 4.0);
  let scale = max(1.0, floor(min(params.canvas.x / (grid.x + 8.0), params.canvas.y / (grid.y + 8.0))));
  let origin = floor((params.canvas - grid * scale) * 0.5);
  let cell = floor((pixel - origin) / scale);
  if (any(cell < vec2f(0.0)) || any(cell >= grid)) {
    return vec3f(0.01);
  }
  let c = vec2u(cell);
  let slice = (c.y / n) * 8u + c.x / n;
  return textureLoad(lut, vec3u(c.x % n, c.y % n, slice), 0).rgb;
}

@fragment fn fs_map(in: FullscreenVarying) -> @location(0) vec4f {
  if (params.view == VIEW_LUT) {
    return vec4f(lut_view(in.position.xy), 1.0);
  }
  let size = textureDimensions(source);
  let block = min(vec2u(in.position.xy / params.block), size - 1u);
  let input = textureLoad(source, block, 0);
  let t = threshold(block);
  if (params.view == VIEW_THRESHOLD) {
    return vec4f(vec3f(srgb_to_linear_f(t)), 1.0);
  }

  var mapped = input.rgb;
  if (input.a > 0.5 && params.mapping > 0.5) {
    let dithered = palette_dither_srgb(linear_to_srgb(input.rgb), t, params.strength);
    if (params.mapping > 1.5) {
      mapped = palette_nearest_exact(palette, srgb_to_linear(clamp(dithered, vec3f(0.0), vec3f(1.0)))).rgb;
    } else {
      mapped = palette_lut_lookup_srgb(lut, dithered).rgb;
    }
  }
  if (params.view == VIEW_ERROR) {
    let error = length(linear_to_oklab(mapped) - linear_to_oklab(max(input.rgb, vec3f(0.0))));
    return vec4f(srgb_to_linear(heat(error * params.error_gain)), 1.0);
  }
  return vec4f(mapped, 1.0);
}
