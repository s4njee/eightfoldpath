/*
 * Picking a sprite under the pointer on the CPU, for the selection outline (story 3.7).
 *
 * A ray from the camera through the pointer meets each upright sprite's quad; the hit counts only
 * where the art is opaque at that texel, so clicking through the gap under a character's arm picks
 * whatever is behind it. The front-most hit wins, and boxes (terrain blocks) can hide sprites.
 * This mirrors the batcher's quad and texel maths (batch.wgsl) instead of reading back an ID
 * buffer, which would cost a GPU round trip and a frame of latency for one pixel.
 */
import { mat4, type Mat4 } from 'wgpu-matrix';
import type { Pixels } from '../assets.ts';
import { TEXEL, type Sprite } from '../sprites/batch.ts';

type Vec3 = readonly [number, number, number];

export interface PickBox {
  min: Vec3;
  max: Vec3;
}

export interface PickOptions {
  camera: { readonly viewProj: Mat4; readonly right: Vec3 };
  /** Pointer position, 0..1 with (0, 0) at the top-left (`trackPointer`'s state). */
  x: number;
  y: number;
  sprites: readonly Sprite[];
  /** The art, indexed by `Sprite.sheet`, as given to the batcher. */
  sheets: readonly Pixels[];
  /** Scene seconds, for the flipbook frame (the batcher's `ViewSettings.time`). */
  time: number;
  /** Opaque boxes that hide sprites behind them. */
  occluders?: readonly PickBox[];
  /** Alpha (0..255) that counts as solid. Default 128, the batcher's hard cut-out. */
  alphaCut?: number;
}

/** A ray through a point of the screen: `origin + t * direction`, t = 0 on the near plane. */
export function pointerRay(
  viewProj: Mat4,
  x: number,
  y: number,
): { origin: Vec3; direction: Vec3 } {
  const inverse = mat4.inverse(viewProj);
  const unproject = (z: number): Vec3 => {
    const ndc = [x * 2 - 1, 1 - y * 2, z, 1];
    const out = [0, 0, 0, 0];
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) out[row]! += inverse[col * 4 + row]! * ndc[col]!;
    }
    return [out[0]! / out[3]!, out[1]! / out[3]!, out[2]! / out[3]!];
  };
  const near = unproject(0);
  const far = unproject(1);
  return { origin: near, direction: [far[0] - near[0], far[1] - near[1], far[2] - near[2]] };
}

/** Ray parameter of the first hit on an axis-aligned box, or Infinity. */
function hitBox(origin: Vec3, direction: Vec3, box: PickBox): number {
  let enter = 0;
  let exit = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const d = direction[axis]!;
    const o = origin[axis]!;
    if (Math.abs(d) < 1e-12) {
      if (o < box.min[axis]! || o > box.max[axis]!) return Infinity;
      continue;
    }
    let t0 = (box.min[axis]! - o) / d;
    let t1 = (box.max[axis]! - o) / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    enter = Math.max(enter, t0);
    exit = Math.min(exit, t1);
    if (enter > exit) return Infinity;
  }
  return enter;
}

/** The index of the front-most upright sprite whose art is under the pointer, or -1. */
export function pickSprite(options: PickOptions): number {
  const { camera, sprites, sheets, time } = options;
  const cut = options.alphaCut ?? 128;
  const { origin, direction } = pointerRay(camera.viewProj, options.x, options.y);
  let nearest = Infinity;
  for (const box of options.occluders ?? [])
    nearest = Math.min(nearest, hitBox(origin, direction, box));

  // Upright sprites turn about the vertical axis to face the camera (batch.wgsl, vs_sprite).
  const length = Math.hypot(camera.right[0], camera.right[2]) || 1;
  const right: Vec3 = [camera.right[0] / length, 0, camera.right[2] / length];
  const normal: Vec3 = [-right[2], 0, right[0]];
  const facing = direction[0] * normal[0] + direction[2] * normal[2];
  if (Math.abs(facing) < 1e-12) return -1;

  let picked = -1;
  sprites.forEach((sprite, index) => {
    if ((sprite.facing ?? 'upright') !== 'upright') return;
    const art = sheets[sprite.sheet];
    if (!art) return;
    const [fx, fy, fz] = sprite.position;
    const t = ((fx - origin[0]) * normal[0] + (fz - origin[2]) * normal[2]) / facing;
    if (t < 0 || t >= nearest) return;

    const region = sprite.region ?? [0, 0, art.width, art.height];
    const scale = sprite.scale ?? 1;
    const size = sprite.size ?? [region[2] * TEXEL * scale, region[3] * TEXEL * scale];
    const hit = [0, 1, 2].map((axis) => origin[axis]! + direction[axis]! * t);
    let u = ((hit[0]! - fx) * right[0] + (hit[2]! - fz) * right[2]) / size[0] + 0.5;
    const v = (hit[1]! - fy) / size[1];
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return;
    if (sprite.flipX) u = 1 - u;

    const frames = Math.max(sprite.frames ?? 1, 1);
    const elapsed = Math.max(time - (sprite.start ?? 0), 0);
    const frame = (Math.floor(elapsed * (sprite.fps ?? 0)) + (sprite.frame ?? 0)) % frames;
    const tx = Math.floor(region[0] + (frame + u) * region[2]);
    const ty = Math.floor(region[1] + (1 - v) * region[3]);
    if (tx < 0 || ty < 0 || tx >= art.width || ty >= art.height) return;
    if (art.data[(ty * art.width + tx) * 4 + 3]! < cut) return;

    nearest = t;
    picked = index;
  });
  return picked;
}
