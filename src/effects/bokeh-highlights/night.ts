// The village terraces at night (story 5.2): the same scene file under a dim blue moon, with six
// more lanterns, four on the back terrace and two on the shore, so a blurred background and a
// blurred foreground each have lights for the bokeh to draw. Eight lanterns, eight point lights:
// as many as a stage takes. A lantern's glass is wider than the blur, so it draws its own shape
// convolved with the aperture's; strings of small bulbs between the lanterns and a few fireflies
// are the points of light that show the aperture itself (`nightLights`).
import village from '../../../assets/scenes/village.json';
import { parseScene, type Scene, type SceneSource } from '../../gpu/diorama/scene.ts';
import type { Sprite } from '../../gpu/sprites/batch.ts';

/** Feet of the added lanterns, x and z; the ground's height is filled in. */
const ADDED: readonly (readonly [number, number])[] = [
  [5.5, 2.4],
  [8.4, 1.2],
  [14.6, 1.4],
  [17.4, 2.8],
  [2.8, 15],
  [21, 15.2],
];

/** Height of a lantern's glass above its feet, as the scene file has it for the plaza's two. */
const GLASS = 4.7;

export function nightVillageScene(): Scene {
  const source = village as unknown as SceneSource;
  return parseScene({
    ...source,
    lights: {
      ...source.lights,
      sun: { elevation: 42, azimuth: -0.5, color: [0.55, 0.66, 1], intensity: 0.25 },
      sky: [0.02, 0.03, 0.07],
      ground: [0.01, 0.01, 0.015],
      points: [
        ...(source.lights?.points ?? []),
        ...ADDED.map(([x, z]) => ({
          at: [x, GLASS, z] as const,
          color: [1, 0.62, 0.3] as const,
          intensity: 3,
          range: 5,
        })),
      ],
    },
    sprites: [
      ...(source.sprites ?? []),
      ...ADDED.map(([x, z], i) => ({ art: 'lantern', at: [x, z] as const, flipX: i % 2 === 1 })),
    ],
    glow: { ...source.glow, lantern: 6 },
  });
}

/** A 2 × 2 patch of the lantern's lit glass (texels of assets/sprites/lantern.png): a bulb. */
const BULB_REGION = [9, 21, 2, 2] as const;
/** A bulb's size, world units: about two texels at the shared density. */
const BULB = 0.12;

/** Strings of bulbs, each from one lantern's glass to the next with a sag, x, z and lift. */
const STRINGS: readonly {
  from: readonly [number, number, number];
  to: readonly [number, number, number];
  sag: number;
  bulbs: number;
}[] = [
  // The back terrace, lantern to lantern.
  { from: [5.5, 4.4, 2.4], to: [8.4, 4.4, 1.2], sag: 0.7, bulbs: 4 },
  { from: [8.4, 4.4, 1.2], to: [14.6, 4.4, 1.4], sag: 1.2, bulbs: 7 },
  { from: [14.6, 4.4, 1.4], to: [17.4, 4.4, 2.8], sag: 0.7, bulbs: 4 },
  // The shore: from each front lantern down towards the middle.
  { from: [2.8, 4.4, 15], to: [7, 1.4, 15.4], sag: 0.6, bulbs: 7 },
  { from: [21, 4.4, 15.2], to: [17, 1.4, 15.4], sag: 0.6, bulbs: 7 },
];

/** Fireflies over the back terrace's grass: x, z and height above it. */
const FIREFLIES: readonly (readonly [number, number, number])[] = [
  [1.4, 3.2, 1.1],
  [3.9, 0.8, 2.3],
  [6.6, 3.4, 0.8],
  [12.3, 3.1, 1.9],
  [16.1, 0.6, 2.8],
  [19.8, 3.5, 1.4],
  [22.6, 1.1, 2.1],
  [20.4, 6.2, 1.2],
  [2.6, 7.1, 1.6],
];

/**
 * The bulbs and fireflies as sprites of the lantern's sheet (`sheet`), for the stage's
 * `setSprites` after the scene's own: small enough to be points of light, so out of focus each one
 * draws the aperture alone.
 */
export function nightLights(scene: Scene, sheet: number): Sprite[] {
  const bulb = (x: number, height: number, z: number): Sprite => ({
    sheet,
    position: [x, scene.heightAt(x, z) + height, z],
    region: BULB_REGION,
    size: [BULB, BULB],
    facing: 'camera',
  });
  const strung = STRINGS.flatMap(({ from, to, sag, bulbs }) =>
    Array.from({ length: bulbs }, (_, i) => {
      // Inside the span only: the ends are the lanterns' glass.
      const t = (i + 1) / (bulbs + 1);
      const at = (k: number) => from[k]! + (to[k]! - from[k]!) * t;
      return bulb(at(0), at(1) - sag * 4 * t * (1 - t), at(2));
    }),
  );
  return [...strung, ...FIREFLIES.map(([x, z, height]) => bulb(x, height, z))];
}

/** How many sprites `nightLights` adds, for the stage's `maxSprites`. */
export const NIGHT_LIGHT_COUNT =
  STRINGS.reduce((sum, string) => sum + string.bulbs, 0) + FIREFLIES.length;
