/*
 * The diorama scene format (story 4.1): a scene a web developer could write by hand.
 *
 *   const scene = parseScene(json);                      // validated, deterministic
 *   const scene = parseScene(json, { map, heights });    // with the maps given as images instead
 *   scene.heightAt(x, z);                                // the ground under a point
 *
 * A scene is a grid of columns. Each cell of the map names a tile kind from the legend: what its
 * top and sides are made of and its shape (a flat block, stairs or a slope). The height map says
 * how tall each column is, in steps of `heightStep` world units. One cell is one world unit, so at
 * the shared density (16 texels a unit) a 99-texel tile image covers about six cells and repeats.
 *
 * Both maps can be written as rows of characters in the JSON, north (−z) first:
 *
 *   "legend": { "g": { "top": "grass", "side": "cliff" }, ".": null },
 *   "map":     ["ggg.", "ggg."],
 *   "heights": ["0011", "0011"]                     // 0-9 then a-z for 10..35
 *
 * or as images, which suit larger scenes painted in any editor: the map's legend keys are then hex
 * colours ("#4a8c3a") and the height is the red channel in steps. Loading is deterministic: the
 * same input gives the same scene, with art names, sprites and lights in a fixed order.
 */
import type { Pixels } from '../assets.ts';

export type Direction = 'n' | 'e' | 's' | 'w';
export type TileShape = 'block' | 'stairs' | 'slope';

export interface TileKind {
  /** Art name for the top face, resolved by the caller (`resolveArt`). */
  top: string;
  /** Art name for the sides. Default: the top's. */
  side?: string;
  /** Default `block`. */
  shape?: TileShape;
  /**
   * Which way stairs and slopes climb. Default: toward the neighbour one step higher (the
   * highest, if several are; north, east, south, west breaks a tie).
   */
  rises?: Direction;
}

export interface SceneSprite {
  /** Art name. */
  art: string;
  /** Feet, x and z in world units; the ground's height is filled in. */
  at: readonly [number, number];
  /** Added to the ground's height. Default 0. */
  lift?: number;
  facing?: 'upright' | 'camera' | 'ground';
  flipX?: boolean;
  scale?: number;
  /** A flipbook: frames left to right, played at `fps`. */
  frames?: number;
  fps?: number;
  /** Linear multiplier; above 1 for emissive sprites such as lanterns. */
  tint?: readonly [number, number, number];
}

export interface PointLight {
  /** World position; `y` is above the ground at `x`, `z`. */
  at: readonly [number, number, number];
  color: readonly [number, number, number];
  intensity: number;
  range: number;
}

export interface SceneLights {
  /** Degrees above the horizon and about +y from +z, like the camera's yaw. */
  sun: {
    elevation: number;
    azimuth: number;
    color: readonly [number, number, number];
    intensity: number;
  };
  /** Hemisphere ambient: light from the sky above and bounced from the ground below. */
  sky: readonly [number, number, number];
  ground: readonly [number, number, number];
  points: readonly PointLight[];
}

export interface CameraPose {
  focus: readonly [number, number, number];
  /** Radians about +y; 0 looks along −z. */
  yaw: number;
  /** Degrees below the horizon. */
  pitch: number;
  /** Vertical field of view in degrees. */
  fov: number;
  distance: number;
}

/** What `scene.json` holds. Everything but the legend and the map has a default. */
export interface SceneSource {
  name?: string;
  /** World units per height step. Default 0.5. */
  heightStep?: number;
  /** The bottom of the diorama, where the outer walls end. Default −1. */
  base?: number;
  /** Map key (a character, or "#rrggbb" for an image map) to a tile kind; null for no block. */
  legend: Readonly<Record<string, TileKind | null>>;
  /** Rows of legend characters, north first. Leave out when the map is given as an image. */
  map?: readonly string[];
  /** Rows of height digits (0-9, a-z), or leave out for an image, or for a flat scene. */
  heights?: readonly string[];
  camera?: Partial<CameraPose>;
  lights?: Partial<Omit<SceneLights, 'sun'>> & { sun?: Partial<SceneLights['sun']> };
  sprites?: readonly SceneSprite[];
  /**
   * Sprite art that gives off light: its bright, warm texels (a lamp's glass, a flame) are drawn
   * this many times brighter than lit white, so bloom and depth of field have lights to work on.
   */
  glow?: Readonly<Record<string, number>>;
}

export interface Cell {
  /** Index into `scene.kinds`, or −1 for an empty cell. */
  kind: number;
  /** Height of the top, in steps. */
  steps: number;
  /** For stairs and slopes, which way they climb. */
  rises?: Direction;
}

export interface Scene {
  readonly name: string;
  readonly width: number;
  readonly depth: number;
  readonly heightStep: number;
  readonly base: number;
  /** The tile kinds the map uses, in the order they first appear. */
  readonly kinds: readonly Required<Omit<TileKind, 'rises'>>[];
  /** Row-major, north first: cell (x, z) is `cells[z * width + x]` and covers x..x+1, z..z+1. */
  readonly cells: readonly Cell[];
  /** Every art name the scene uses, sorted, so sheet indices are stable. */
  readonly art: readonly string[];
  readonly camera: CameraPose;
  readonly lights: SceneLights;
  /** Sprites with their feet on the ground, in the order written. */
  readonly sprites: readonly (SceneSprite & { position: [number, number, number] })[];
  /** Glow strength by sprite art name; see `SceneSource.glow`. */
  readonly glow: Readonly<Record<string, number>>;
  cell(x: number, z: number): Cell | undefined;
  /** Top of the column under (x, z) in world units, following stairs and slopes; `base` off the map. */
  heightAt(x: number, z: number): number;
}

export interface SceneImages {
  map?: Pixels;
  heights?: Pixels;
}

const DIRECTIONS: readonly Direction[] = ['n', 'e', 's', 'w'];
/** Neighbour offsets for n, e, s, w: north is −z. */
export const STEP: Readonly<Record<Direction, readonly [number, number]>> = {
  n: [0, -1],
  e: [1, 0],
  s: [0, 1],
  w: [-1, 0],
};

const DEFAULT_CAMERA: CameraPose = { focus: [0, 0, 0], yaw: 0, pitch: 35, fov: 25, distance: 30 };

function heightDigit(char: string, where: string): number {
  const value = parseInt(char, 36);
  if (Number.isNaN(value)) throw new Error(`Scene: height "${char}" at ${where} is not 0-9 or a-z`);
  return value;
}

const hex = (pixels: Pixels, i: number) =>
  '#' + [0, 1, 2].map((c) => pixels.data[i * 4 + c]!.toString(16).padStart(2, '0')).join('');

/** Validates a scene and lays it out. Throws with the place of the first problem. */
export function parseScene(source: SceneSource, images: SceneImages = {}): Scene {
  const legend = new Map<string, TileKind | null>();
  for (const [key, kind] of Object.entries(source.legend)) {
    legend.set(key.startsWith('#') ? key.toLowerCase() : key, kind);
  }

  // The map, as legend keys.
  let width: number;
  let depth: number;
  let keyAt: (x: number, z: number) => string;
  if (images.map) {
    const map = images.map;
    width = map.width;
    depth = map.height;
    keyAt = (x, z) =>
      map.data[(z * map.width + x) * 4 + 3]! < 128 ? '' : hex(map, z * map.width + x);
  } else if (source.map?.length) {
    const rows = source.map;
    width = Math.max(...rows.map((row) => row.length));
    depth = rows.length;
    keyAt = (x, z) => rows[z]![x] ?? ' ';
  } else {
    throw new Error('Scene: no map (give "map" rows or a map image)');
  }

  let stepsAt: (x: number, z: number) => number = () => 0;
  if (images.heights) {
    const heights = images.heights;
    if (heights.width !== width || heights.height !== depth) {
      throw new Error(
        `Scene: the height image is ${heights.width}×${heights.height}, the map ${width}×${depth}`,
      );
    }
    stepsAt = (x, z) => heights.data[(z * width + x) * 4]!;
  } else if (source.heights) {
    const rows = source.heights;
    if (rows.length !== depth || rows.some((row) => row.length !== width)) {
      throw new Error(`Scene: "heights" must be ${depth} rows of ${width}, like the map`);
    }
    stepsAt = (x, z) => heightDigit(rows[z]![x]!, `row ${z + 1}, column ${x + 1}`);
  }

  const kinds: Required<Omit<TileKind, 'rises'>>[] = [];
  const kindIndex = new Map<string, number>();
  const explicitRise: (Direction | undefined)[] = [];
  const cells: Cell[] = [];
  for (let z = 0; z < depth; z++) {
    for (let x = 0; x < width; x++) {
      const key = keyAt(x, z);
      // A space (or a transparent pixel) is always empty, so ragged rows need no padding.
      if (key === ' ' || key === '') {
        cells.push({ kind: -1, steps: 0 });
        explicitRise.push(undefined);
        continue;
      }
      if (!legend.has(key)) {
        throw new Error(`Scene: "${key}" at row ${z + 1}, column ${x + 1} is not in the legend`);
      }
      const kind = legend.get(key);
      if (!kind) {
        cells.push({ kind: -1, steps: 0 });
        explicitRise.push(undefined);
        continue;
      }
      if (!kind.top) throw new Error(`Scene: legend entry "${key}" has no "top"`);
      let index = kindIndex.get(key);
      if (index === undefined) {
        index = kinds.length;
        kindIndex.set(key, index);
        kinds.push({ top: kind.top, side: kind.side ?? kind.top, shape: kind.shape ?? 'block' });
      }
      cells.push({ kind: index, steps: stepsAt(x, z) });
      explicitRise.push(kind.rises);
    }
  }

  const cellAt = (x: number, z: number) =>
    x >= 0 && z >= 0 && x < width && z < depth ? cells[z * width + x] : undefined;

  // Stairs and slopes climb toward a neighbour; find which, once the heights are known.
  for (let z = 0; z < depth; z++) {
    for (let x = 0; x < width; x++) {
      const cell = cells[z * width + x]!;
      if (cell.kind < 0 || kinds[cell.kind]!.shape === 'block') continue;
      let rises = explicitRise[z * width + x];
      if (!rises) {
        let best = 0;
        for (const direction of DIRECTIONS) {
          const [dx, dz] = STEP[direction];
          const next = cellAt(x + dx, z + dz);
          if (next && next.kind >= 0 && next.steps - cell.steps > best) {
            best = next.steps - cell.steps;
            rises = direction;
          }
        }
      }
      if (!rises) {
        throw new Error(
          `Scene: the ${kinds[cell.kind]!.shape} at row ${z + 1}, column ${x + 1} has no higher neighbour to climb to; give it "rises"`,
        );
      }
      cell.rises = rises;
    }
  }

  const heightStep = source.heightStep ?? 0.5;
  const base = source.base ?? -1;
  const lights = source.lights ?? {};
  const sun = {
    elevation: 40,
    azimuth: 2.4,
    color: [1, 0.92, 0.78] as const,
    intensity: 1.2,
    ...lights.sun,
  };

  const scene: Scene = {
    name: source.name ?? 'Untitled',
    width,
    depth,
    heightStep,
    base,
    kinds,
    cells,
    art: [
      ...new Set([
        ...kinds.flatMap((kind) => [kind.top, kind.side]),
        ...(source.sprites ?? []).map((sprite) => sprite.art),
      ]),
    ].sort(),
    camera: { ...DEFAULT_CAMERA, ...source.camera },
    lights: {
      sun,
      sky: lights.sky ?? [0.32, 0.38, 0.55],
      ground: lights.ground ?? [0.12, 0.1, 0.08],
      points: (lights.points ?? []).map((light) => ({
        ...light,
        at: [
          light.at[0],
          heightAtWith(light.at[0], light.at[2]) + light.at[1],
          light.at[2],
        ] as const,
      })),
    },
    sprites: [],
    glow: { ...source.glow },
    cell: cellAt,
    heightAt: (x, z) => heightAtWith(x, z),
  };

  function heightAtWith(x: number, z: number): number {
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    const cell = cellAt(cx, cz);
    if (!cell || cell.kind < 0) return base;
    const top = cell.steps * heightStep;
    if (!cell.rises) return top;
    // Fraction of the way across the cell in the direction it climbs.
    const fx = x - cx;
    const fz = z - cz;
    const along = { n: 1 - fz, s: fz, e: fx, w: 1 - fx }[cell.rises];
    const rise = riseOf(cell, cx, cz);
    if (kinds[cell.kind]!.shape === 'slope') return top + along * rise;
    const steps = stairCount(rise);
    return top + (Math.min(Math.floor(along * steps), steps - 1) / steps) * rise;
  }

  function riseOf(cell: Cell, x: number, z: number): number {
    const [dx, dz] = STEP[cell.rises!];
    const next = cellAt(x + dx, z + dz);
    const steps = next && next.kind >= 0 ? Math.max(next.steps - cell.steps, 1) : 1;
    return steps * heightStep;
  }

  (scene as { sprites: Scene['sprites'] }).sprites = (source.sprites ?? []).map((sprite) => ({
    ...sprite,
    position: [
      sprite.at[0],
      heightAtWith(sprite.at[0], sprite.at[1]) + (sprite.lift ?? 0),
      sprite.at[1],
    ],
  }));
  return scene;
}

/** How many treads a flight of stairs has: one for every quarter unit it climbs, at least two. */
export function stairCount(rise: number): number {
  return Math.max(2, Math.round(rise / 0.25));
}

/** How far a stairs or slope cell climbs, in world units: to its higher neighbour, or one step. */
export function cellRise(scene: Scene, x: number, z: number): number {
  const cell = scene.cell(x, z);
  if (!cell?.rises) return 0;
  const [dx, dz] = STEP[cell.rises];
  const next = scene.cell(x + dx, z + dz);
  const steps = next && next.kind >= 0 ? Math.max(next.steps - cell.steps, 1) : 1;
  return steps * scene.heightStep;
}
