/*
 * The tile extruder's layout (story 4.2): a scene's columns as boxes, on the CPU.
 *
 * Every column becomes one box: a top at the column's height (tilted for a slope), and four sides
 * that run down only as far as the ground beside them, so faces nobody can see collapse to nothing
 * in the vertex stage. Stairs become one box per tread. The GPU side (terrain.ts) draws every box
 * with one instanced draw call; this file is plain arithmetic so it can be tested without a GPU.
 */
import { cellRise, STEP, stairCount, type Direction, type Scene } from './scene.ts';

/** Floats per box: five vec4s, matching `Box` in terrain.wgsl. */
export const BOX_FLOATS = 20;

/** Bits of a box's flags: a lower neighbour on that side, so its top gets a lit rim there. */
export const RIM: Readonly<Record<Direction, number>> = { n: 1, e: 2, s: 4, w: 8 };

export interface Box {
  /** The north-west corner and the size, in world units. */
  x: number;
  z: number;
  sx: number;
  sz: number;
  /** Heights of the top at its corners: north-west, north-east, south-east, south-west. */
  top: readonly [number, number, number, number];
  /** How far each side (n, e, s, w) runs down: the lowest ground beside it. */
  bottom: readonly [number, number, number, number];
  /** Art names, resolved to texture-array layers by the caller. */
  topArt: string;
  sideArt: string;
  flags: number;
  /**
   * The top art of each neighbour (n, e, s, w) that meets this top at the same height with a
   * different art, so the two can be dithered together; undefined where there is nothing to blend.
   */
  blend: readonly [string?, string?, string?, string?];
}

const SIDES: readonly Direction[] = ['n', 'e', 's', 'w'];
/** Just outside a face, so the height found is the neighbour's. */
const OUTSIDE = 1e-3;

export function extrude(scene: Scene): Box[] {
  const boxes: Box[] = [];
  const { heightStep } = scene;

  // The ground beside a face: the lowest of the two ends of the edge, just outside it. Lowest, so
  // a face beside stairs or a slope runs under them rather than leaving a gap; depth hides the rest.
  function besideFace(x0: number, z0: number, x1: number, z1: number, side: Direction): number {
    const [dx, dz] = STEP[side];
    // Pull the ends a hair in along the edge, so a corner never samples the diagonal neighbour.
    const ix = Math.sign(x1 - x0) * OUTSIDE;
    const iz = Math.sign(z1 - z0) * OUTSIDE;
    return Math.min(
      scene.heightAt(x0 + ix + dx * OUTSIDE, z0 + iz + dz * OUTSIDE),
      scene.heightAt(x1 - ix + dx * OUTSIDE, z1 - iz + dz * OUTSIDE),
    );
  }

  function addBox(
    x: number,
    z: number,
    sx: number,
    sz: number,
    top: Box['top'],
    kind: Scene['kinds'][number],
    flat: boolean,
    cx: number,
    cz: number,
  ) {
    const edges: Readonly<Record<Direction, readonly [number, number, number, number]>> = {
      n: [x, z, x + sx, z],
      e: [x + sx, z, x + sx, z + sz],
      s: [x, z + sz, x + sx, z + sz],
      w: [x, z, x, z + sz],
    };
    const bottom = SIDES.map((side) =>
      besideFace(...edges[side], side),
    ) as unknown as Box['bottom'];
    let flags = 0;
    const blend: (string | undefined)[] = [];
    const height = top[0];
    for (const [i, side] of SIDES.entries()) {
      if (bottom[i]! < Math.min(...top) - 1e-4) flags |= RIM[side];
      const [dx, dz] = STEP[side];
      const next = scene.cell(cx + dx, cz + dz);
      const nextKind = next && next.kind >= 0 ? scene.kinds[next.kind] : undefined;
      blend.push(
        flat &&
          nextKind &&
          nextKind.shape === 'block' &&
          next!.steps * heightStep === height &&
          nextKind.top !== kind.top
          ? nextKind.top
          : undefined,
      );
    }
    boxes.push({
      x,
      z,
      sx,
      sz,
      top,
      bottom,
      topArt: kind.top,
      sideArt: kind.side,
      flags,
      blend: blend as unknown as Box['blend'],
    });
  }

  for (let cz = 0; cz < scene.depth; cz++) {
    for (let cx = 0; cx < scene.width; cx++) {
      const cell = scene.cell(cx, cz)!;
      if (cell.kind < 0) continue;
      const kind = scene.kinds[cell.kind]!;
      const h = cell.steps * heightStep;
      if (kind.shape === 'block' || !cell.rises) {
        addBox(cx, cz, 1, 1, [h, h, h, h], kind, true, cx, cz);
        continue;
      }
      const rise = cellRise(scene, cx, cz);
      if (kind.shape === 'slope') {
        // Corner order nw, ne, se, sw; the side it climbs toward is raised.
        const up = h + rise;
        const top: Record<Direction, Box['top']> = {
          n: [up, up, h, h],
          s: [h, h, up, up],
          e: [h, up, up, h],
          w: [up, h, h, up],
        };
        addBox(cx, cz, 1, 1, top[cell.rises], kind, false, cx, cz);
        continue;
      }
      // Stairs: one box per tread, the first flush with the cell's own height.
      const treads = stairCount(rise);
      for (let i = 0; i < treads; i++) {
        const t = h + (i / treads) * rise;
        const a = i / treads;
        const b = 1 / treads;
        const tread: Record<Direction, [number, number, number, number]> = {
          n: [cx, cz + 1 - a - b, 1, b],
          s: [cx, cz + a, 1, b],
          e: [cx + a, cz, b, 1],
          w: [cx + 1 - a - b, cz, b, 1],
        };
        const [x, z, sx, sz] = tread[cell.rises];
        addBox(x, z, sx, sz, [t, t, t, t], kind, false, cx, cz);
      }
    }
  }
  return boxes;
}

/** Packs boxes for terrain.wgsl, with art names turned into texture-array layers. */
export function packBoxes(boxes: readonly Box[], layerOf: (art: string) => number): Float32Array {
  const data = new Float32Array(boxes.length * BOX_FLOATS);
  boxes.forEach((box, i) => {
    data.set(
      [
        box.x,
        box.z,
        box.sx,
        box.sz,
        ...box.top,
        ...box.bottom,
        layerOf(box.topArt),
        layerOf(box.sideArt),
        box.flags,
        0,
        ...box.blend.map((art) => (art === undefined ? -1 : layerOf(art))),
      ],
      i * BOX_FLOATS,
    );
  });
  return data;
}
