// The study street's shade for the sprite batcher (tilt-shift-street.ts): a cool dusk sky everywhere, warm
// pools of light round each lantern, and the lanterns' bright yellow glass made emissive, several
// times brighter than white, so the lens has small bright lights to blur. The batcher compiles
// this from a string after the generated `SceneShade` struct.

@group(2) @binding(0) var<uniform> scene: SceneShade;

const SKY = vec3f(0.42, 0.46, 0.66);
const LAMP = vec3f(1.0, 0.72, 0.4);
/** World units at which a lantern's pool of light has faded out. */
const REACH = 5.5;

fn sprite_shade(f: SpriteFragment) -> vec3f {
  let c = f.color.rgb;
  // The glass: the lantern sheet's bright, warm pixels.
  if (f.layer == i32(scene.lantern_layer) && c.r + c.g > 1.2 && c.b < 0.45) {
    return c * scene.glow;
  }
  var light = SKY;
  for (var i = 0u; i < u32(scene.light_count); i++) {
    let falloff = 1.0 - smoothstep(0.0, REACH, distance(f.world, scene.lights[i].xyz));
    light += LAMP * 1.3 * falloff * falloff;
  }
  return c * light;
}
