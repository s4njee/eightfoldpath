// The sprite batcher's shade for story 3.3: point lights, ambient and a rim on the art, read
// through each sprite's normal map, optionally quantised into bands and snapped to the palette.
//
// The batcher compiles this from a string, after src/wgsl/sprite-light.wgsl (the helpers) and the
// generated `LightParams` struct (index.ts). Which normals a sprite has (flat, painted or
// automatic) is decided by which copy of its sheet it uses, so this code never branches on it.

// params.view: what the pass writes, for the layer inspector.
const VIEW_ALBEDO = 1.0;
const VIEW_NORMALS = 2.0;
const VIEW_LIGHTING = 3.0;
const QUANTISE_STEPS = 1.0;
const QUANTISE_PALETTE = 2.0;

@group(2) @binding(0) var<uniform> light: LightParams;

// Nearest palette colour by OKLab distance. 48 entries is a short loop for the few thousand
// sprite pixels on screen; a full-screen pass would want story 3.5's lookup texture instead.
fn snap_to_palette(c: vec3f) -> vec3f {
  let lab = sprite_light_oklab(c);
  var best = 1e9;
  var out = c;
  for (var i = 0u; i < u32(light.palette_count); i++) {
    let d = lab - light.palette_lab[i].xyz;
    let distance_sq = dot(d, d);
    if (distance_sq < best) {
      best = distance_sq;
      out = light.palette_linear[i].rgb;
    }
  }
  return out;
}

fn sprite_shade(f: SpriteFragment) -> vec3f {
  // The light markers are tiny emissive discs, far over SDR white so the tail blooms them.
  if (f.layer == i32(light.marker_layer)) {
    let i = clamp(i32(f.index) - i32(light.first_marker), 0, 2);
    let c = light.lights[i * 3 + 1];
    return c.rgb * light.marker_glow * light.lights_on;
  }
  let albedo = f.color.rgb;
  let n = sprite_light_normal(f);
  let to_eye = normalize(view.eye.xyz - f.world);
  let steps = select(0.0, light.bands, light.quantise >= QUANTISE_STEPS);

  var lit = light.ambient;
  for (var i = 0; i < i32(light.light_count); i++) {
    let p = light.lights[i * 3];
    let c = light.lights[i * 3 + 1];
    // Each light belongs to one column of the comparison and lights nothing outside it.
    let column = light.lights[i * 3 + 2];
    if (abs(f.world.x - column.x) > column.y) {
      continue;
    }
    // Quantised per light, so each light draws its own bands as an artist would shade them.
    let e = sprite_light_bands(sprite_light_point(f.world, n, p.xyz, p.w) * c.w, steps);
    lit += c.rgb * e * light.lights_on;
  }
  let rim = sprite_light_bands(
    sprite_light_rim(n, to_eye, light.rim_direction, light.rim_power) * light.rim_strength,
    steps,
  );

  if (light.view == VIEW_ALBEDO) {
    return albedo;
  }
  if (light.view == VIEW_NORMALS) {
    return n * 0.5 + 0.5;
  }
  if (light.view == VIEW_LIGHTING) {
    return lit + light.rim_color * rim;
  }
  // The rim is light too, but it keeps a little of its own colour so it reads on dark cloth.
  var color = albedo * lit + light.rim_color * rim * (albedo + 0.15);
  if (light.quantise >= QUANTISE_PALETTE) {
    color = snap_to_palette(color);
  }
  return color;
}
