// The two shade functions a diorama stage gives its terrain and its sprites (stage.ts). Each is
// compiled on its own, after light.wgsl; the terrain's never sees the sprites' and the other way
// round, so stage.ts splits this file at the marker below.

fn terrain_shade(f: TerrainFragment) -> vec3f {
  let visible = diorama_shadow(f.world, f.normal);
  let irradiance = diorama_irradiance(f.world, f.normal, 0.0, visible);
  // The rim brightens the top edge above a drop, as a pixel artist lights a ledge.
  return diorama_output(f.color * (1.0 + f.rim), irradiance, f.normal, f.world);
}

// ---- sprites ----

fn sprite_shade(f: SpriteFragment) -> vec3f {
  // Glowing art (scene.glow): its bright, warm texels give off their own light.
  let glow = light.sheet_glow[f.layer].x;
  let c = f.color.rgb;
  if (glow > 0.0 && c.r + c.g > 1.2 && c.b < 0.45 && light.view_mode == 0.0) {
    return c * glow;
  }
  let n = sprite_light_normal(f);
  // A sprite takes its shadow as a whole, from the ground just on the sun's side of its feet:
  // read at the quad itself the shadow map would hold the sprite's own light-facing card and
  // shadow half of it.
  let sprite = sprites[f.index];
  let toward_sun = vec2f(light.to_sun.x, light.to_sun.z);
  let side = toward_sun / max(length(toward_sun), 1e-4) * sprite.size.x * 0.6;
  let probe = sprite.position.xyz + vec3f(side.x, 0.05, side.y);
  let visible = diorama_shadow(probe, vec3f(0.0, 1.0, 0.0));
  let irradiance = diorama_irradiance(f.world, n, 0.4, visible);
  return diorama_output(f.color.rgb, irradiance, n, f.world);
}
