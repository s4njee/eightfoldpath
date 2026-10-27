// Pixel parallax header (story 9.4): five flat layers composited in one fullscreen pass.
//
// Each layer is placed by a 2D offset (index.ts works out where from its depth), so a pixel's
// texel in layer i is `pixel / scale + origin_i`. Layers are read front to back and the loop stops
// as soon as the pixel is covered, so the bottom of the header, where the grass and the trees are
// solid, reads two textures instead of five.
//
// In focus, a layer is read with sharp sampling (src/wgsl/sampling.wgsl, story 3.1's default),
// repeating horizontally. Out of focus, it is read from its pre-blurred copy (src/gpu/lens/
// layer-dof.ts) with one bilinear sample; a layer just leaving focus crossfades between the two.
//
// `fs_mask` draws the occlusion mask for the light shafts at reduced resolution: the sun's light
// wherever the sky is seen, black where a layer covers it.

#include "color.wgsl"
#include "fullscreen.wgsl"
#include "sampling.wgsl"
#include "params.wgsl"

@group(0) @binding(0) var<uniform> params: Params;
// Linear filtering, repeating in x (the layers tile) and clamped in y.
@group(0) @binding(1) var samp: sampler;
// The art, one single-layer array per picture so each keeps its own width to repeat at.
@group(0) @binding(2) var art_sky: texture_2d_array<f32>;
@group(0) @binding(3) var art_mountains: texture_2d_array<f32>;
@group(0) @binding(4) var art_hills: texture_2d_array<f32>;
@group(0) @binding(5) var art_trees: texture_2d_array<f32>;
@group(0) @binding(6) var art_front: texture_2d_array<f32>;
// The blurred copies: premultiplied linear colour at a few times the art's resolution.
@group(0) @binding(7) var dof_sky: texture_2d<f32>;
@group(0) @binding(8) var dof_mountains: texture_2d<f32>;
@group(0) @binding(9) var dof_hills: texture_2d<f32>;
@group(0) @binding(10) var dof_trees: texture_2d<f32>;
@group(0) @binding(11) var dof_front: texture_2d<f32>;

const VIEW_LAYERS = 1.0;
const VIEW_COC = 2.0;

struct Layer {
  origin: vec2f,
  size: vec2f,
  // 0 reads the sharp art, 1 the blurred copy.
  blur_mix: f32,
  // How far the layer's colour is pulled toward the haze colour.
  haze: f32,
  // Blur in art texels, for the circle-of-confusion view and the sun's edge.
  sigma: f32,
  depth: f32,
}

fn layer(i: u32) -> Layer {
  let a = params.layers[i * 2u];
  let b = params.layers[i * 2u + 1u];
  return Layer(a.xy, a.zw, b.x, b.y, b.z, b.w);
}

/** Premultiplied linear colour of one layer at framebuffer pixel `pixel`. */
fn sample_layer(
  art: texture_2d_array<f32>,
  dof: texture_2d<f32>,
  l: Layer,
  pixel: vec2f,
  footprint: f32,
) -> vec4f {
  // Wrapped into the first copy of the layer: the sampler repeats for the sharp and bilinear
  // modes, but nearest reads with textureLoad, which clamps.
  let raw = pixel * params.inv_scale + l.origin;
  let texel = vec2f(raw.x - floor(raw.x / l.size.x) * l.size.x, raw.y);
  var c = vec4f(0.0);
  // The mix is the same for every pixel, so these branches are uniform and cost nothing.
  if (l.blur_mix < 1.0) {
    // The art's transparent texels carry their neighbours' colour (bleedColour in index.ts), so
    // the one-pixel blend at an edge fades the colour out instead of darkening it.
    let s = sample_pixel_art(u32(params.sampling), art, samp, texel, vec2f(footprint), 0);
    c = vec4f(s.rgb * s.a, s.a);
  }
  if (l.blur_mix > 0.0) {
    c = mix(c, textureSampleLevel(dof, samp, texel / l.size, 0.0), l.blur_mix);
  }
  return vec4f(mix(c.rgb, params.haze_color * c.a, l.haze), c.a);
}

/**
 * The sun and its glow, drawn on the sky. It is part of the sky at infinity, so it stays put while
 * the layers drift. In focus its disc is built from whole texels, like the art; out of focus it
 * becomes a smooth disc with an edge as soft as the sky's blur.
 */
fn sun_light(pixel: vec2f, sky: Layer) -> vec3f {
  if (params.sun_on < 0.5) {
    return vec3f(0.0);
  }
  let local = (pixel - params.sun) * params.inv_scale;
  let d = mix(length(floor(local) + 0.5), length(local), sky.blur_mix);
  let edge = max(sky.sigma, params.inv_scale);
  let disc = clamp((params.sun_radius - d) / (2.0 * edge) + 0.5, 0.0, 1.0);
  let glow = params.halo * exp(-max(d - params.sun_radius, 0.0) / (2.0 * params.sun_radius));
  return params.sun_color * params.sun_intensity * (disc + glow);
}

fn sky_colour(pixel: vec2f, footprint: f32) -> vec3f {
  let l = layer(0u);
  return sample_layer(art_sky, dof_sky, l, pixel, footprint).rgb + sun_light(pixel, l);
}

fn over(front: vec4f, back: vec4f) -> vec4f {
  return front + back * (1.0 - front.a);
}

/** Inspector views: each layer as a flat colour by depth, or by its blur. */
fn debug_colour(l: Layer) -> vec3f {
  if (params.view == VIEW_COC) {
    // Gold where a layer is in focus, then black to white up to the largest blur on screen.
    if (l.sigma < 0.01) {
      return vec3f(0.6, 0.35, 0.02);
    }
    return vec3f(srgb_to_linear_f(l.sigma / max(params.max_sigma, 1e-3)));
  }
  return mix(vec3f(0.02, 0.05, 0.3), vec3f(1.0, 0.45, 0.08), l.depth);
}

fn debug_view(pixel: vec2f) -> vec4f {
  var acc = vec4f(0.0);
  let fp = params.inv_scale;
  let alpha = array<f32, 4>(
    sample_sharp(art_front, samp, pixel * params.inv_scale + layer(4u).origin, vec2f(fp), 0).a,
    sample_sharp(art_trees, samp, pixel * params.inv_scale + layer(3u).origin, vec2f(fp), 0).a,
    sample_sharp(art_hills, samp, pixel * params.inv_scale + layer(2u).origin, vec2f(fp), 0).a,
    sample_sharp(art_mountains, samp, pixel * params.inv_scale + layer(1u).origin, vec2f(fp), 0).a,
  );
  for (var k = 0u; k < 4u; k++) {
    acc = over(acc, vec4f(debug_colour(layer(4u - k)), 1.0) * alpha[k]);
  }
  return vec4f(over(acc, vec4f(debug_colour(layer(0u)), 1.0)).rgb, 1.0);
}

@fragment fn fs(in: FullscreenVarying) -> @location(0) vec4f {
  let pixel = in.position.xy;
  if (params.view > 0.5) {
    return debug_view(pixel);
  }
  let fp = params.inv_scale;
  var acc = sample_layer(art_front, dof_front, layer(4u), pixel, fp);
  if (acc.a < 0.999) {
    acc = over(acc, sample_layer(art_trees, dof_trees, layer(3u), pixel, fp));
  }
  if (acc.a < 0.999) {
    acc = over(acc, sample_layer(art_hills, dof_hills, layer(2u), pixel, fp));
  }
  if (acc.a < 0.999) {
    acc = over(acc, sample_layer(art_mountains, dof_mountains, layer(1u), pixel, fp));
  }
  if (acc.a < 0.999) {
    acc = over(acc, vec4f(sky_colour(pixel, fp), 1.0));
  }
  return vec4f(acc.rgb, 1.0);
}

@fragment fn fs_mask(in: FullscreenVarying) -> @location(0) vec4f {
  let pixel = in.uv * params.canvas;
  // One mask pixel covers `mask_divisor` canvas pixels on each side.
  let fp = params.inv_scale * params.mask_divisor;
  var cover = sample_layer(art_front, dof_front, layer(4u), pixel, fp).a;
  cover += (1.0 - cover) * sample_layer(art_trees, dof_trees, layer(3u), pixel, fp).a;
  cover += (1.0 - cover) * sample_layer(art_hills, dof_hills, layer(2u), pixel, fp).a;
  cover += (1.0 - cover) * sample_layer(art_mountains, dof_mountains, layer(1u), pixel, fp).a;
  return vec4f(sun_light(pixel, layer(0u)) * (1.0 - cover), 1.0);
}
