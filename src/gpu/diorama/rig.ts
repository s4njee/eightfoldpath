/*
 * The camera rig (story 4.3): the diorama camera and the ways a page moves it.
 *
 *   const rig = createCameraRig(scene.camera, { bounds: [0, 0, scene.width, scene.depth] });
 *   rig.pan(dx, dz);  rig.dolly(factor);  rig.parallax(px, py);   // from input, any time
 *   rig.follow(path, progress);                                    // or along a path
 *   const camera = rig.update(dt, aspect);                        // once a frame
 *
 * The rig is plain state and arithmetic, with no DOM, so a page can drive it from anything: a drag,
 * the wheel, the pointer's position, the time, or how far the page has scrolled
 * (`scrollProgress`). Everything it is asked for is eased, so input never jolts the view.
 * `orthographic` gives the same framing without perspective, as a comparison: at the focus the
 * picture is the same size, but nothing shrinks with distance.
 */
import { mat4 } from 'wgpu-matrix';
import { dioramaCamera, type CameraState } from '../sprites/camera.ts';
import type { CameraPose } from './scene.ts';

export type Projection = 'perspective' | 'orthographic';

/** A pose on a camera path. `at` is where along the path, 0..1, in increasing order. */
export interface PathKey extends CameraPose {
  at: number;
}

export interface RigOptions {
  /** Keep the focus over this rectangle: x0, z0, x1, z1. */
  bounds?: readonly [number, number, number, number];
  /** Nearest and farthest the camera may dolly, as factors of the starting distance. */
  dollyRange?: readonly [number, number];
  /** Seconds for the camera to cover most (63%) of a change. Default 0.25. */
  ease?: number;
  /** Radians of yaw and degrees of pitch at the edge of the canvas, for pointer parallax. */
  parallax?: { yaw: number; pitch: number };
}

export interface CameraRig {
  /** Where the camera is heading; input moves this, and the camera eases toward it. */
  readonly target: CameraPose;
  /** Where the camera is now. */
  readonly pose: CameraPose;
  projection: Projection;
  /** Move the focus by world units along the ground, as seen from the camera: x right, z away. */
  pan(right: number, away: number): void;
  /** Multiply the distance; below 1 moves in. */
  dolly(factor: number): void;
  /** Pointer position from the centre, −1..1 on each axis; 0, 0 when the pointer leaves. */
  parallax(x: number, y: number): void;
  /** Put the target on `path` at `progress` (0..1). */
  follow(path: readonly PathKey[], progress: number): void;
  /** Jump to the target with no easing, e.g. for a still frame. */
  settle(): void;
  /** Advance the easing by `dt` seconds; `ease` overrides the option for this frame. */
  update(dt: number, aspect: number, ease?: number): CameraState;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const smoothstep = (t: number) => t * t * (3 - 2 * t);

function copy(pose: CameraPose): CameraPose {
  return { ...pose, focus: [...pose.focus] };
}

/** Catmull–Rom through four values, at `t` between the middle two. */
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  return (
    0.5 *
    (2 * p1 +
      (p2 - p0) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (3 * p1 - p0 - 3 * p2 + p3) * t2 * t)
  );
}

/**
 * The pose `progress` of the way along a path. The focus follows a Catmull–Rom curve through the
 * keys, so a path through several places is smooth; the angles, distance and field of view ease
 * between neighbouring keys, so the camera settles on each key rather than overshooting it.
 */
export function poseOnPath(path: readonly PathKey[], progress: number): CameraPose {
  if (!path.length) throw new Error('poseOnPath: empty path');
  const p = clamp(progress, path[0]!.at, path[path.length - 1]!.at);
  let i = 0;
  while (i < path.length - 2 && p > path[i + 1]!.at) i++;
  const a = path[i]!;
  const b = path[Math.min(i + 1, path.length - 1)]!;
  const span = b.at - a.at;
  const t = span > 0 ? (p - a.at) / span : 0;
  const before = path[Math.max(i - 1, 0)]!;
  const after = path[Math.min(i + 2, path.length - 1)]!;
  const s = smoothstep(t);
  const lerp = (x: number, y: number) => x + (y - x) * s;
  return {
    focus: [0, 1, 2].map((k) =>
      catmullRom(before.focus[k]!, a.focus[k]!, b.focus[k]!, after.focus[k]!, s),
    ) as unknown as CameraPose['focus'],
    yaw: lerp(a.yaw, b.yaw),
    pitch: lerp(a.pitch, b.pitch),
    fov: lerp(a.fov, b.fov),
    distance: lerp(a.distance, b.distance),
  };
}

/**
 * How far an element has travelled through the viewport: 0 as its top enters at the bottom, 1 as
 * its bottom leaves at the top. For driving a path from the page's scroll.
 */
export function scrollProgress(
  rect: { top: number; height: number },
  viewportHeight: number,
): number {
  return clamp((viewportHeight - rect.top) / (viewportHeight + rect.height), 0, 1);
}

/** The camera for a pose. Orthographic frames the same height at the focus as perspective does. */
export function poseCamera(pose: CameraPose, aspect: number, projection: Projection): CameraState {
  const near = Math.max(pose.distance * 0.05, 0.05);
  const far = pose.distance * 4 + 50;
  const camera = dioramaCamera({ ...pose, aspect, near, far });
  if (projection === 'perspective') return camera;
  const half = pose.distance * Math.tan((pose.fov * Math.PI) / 360);
  const projectionMatrix = mat4.ortho(-half * aspect, half * aspect, -half, half, near, far);
  return {
    ...camera,
    projection: projectionMatrix,
    viewProj: mat4.multiply(projectionMatrix, camera.view),
  };
}

export function createCameraRig(start: CameraPose, options: RigOptions = {}): CameraRig {
  const target = copy(start);
  const pose = copy(start);
  const [nearest, farthest] = options.dollyRange ?? [0.5, 1.6];
  const ease = options.ease ?? 0.25;
  const sway = options.parallax ?? { yaw: 0.06, pitch: 2 };
  // Parallax rides on top of the target rather than moving it, so it springs back on its own.
  const lean = { x: 0, y: 0 };
  const leaning = { x: 0, y: 0 };

  function keepInBounds() {
    if (!options.bounds) return;
    const [x0, z0, x1, z1] = options.bounds;
    target.focus = [
      clamp(target.focus[0], x0, x1),
      target.focus[1],
      clamp(target.focus[2], z0, z1),
    ];
  }

  const rig: CameraRig = {
    target,
    pose,
    projection: 'perspective',
    pan(right, away) {
      // Along the ground: the camera's right, and its forward flattened onto the ground.
      const r = [Math.cos(target.yaw), 0, -Math.sin(target.yaw)];
      const f = [-Math.sin(target.yaw), 0, -Math.cos(target.yaw)];
      target.focus = [
        target.focus[0] + r[0]! * right + f[0]! * away,
        target.focus[1],
        target.focus[2] + r[2]! * right + f[2]! * away,
      ];
      keepInBounds();
    },
    dolly(factor) {
      target.distance = clamp(
        target.distance * factor,
        start.distance * nearest,
        start.distance * farthest,
      );
    },
    parallax(x, y) {
      lean.x = clamp(x, -1, 1);
      lean.y = clamp(y, -1, 1);
    },
    follow(path, progress) {
      const next = poseOnPath(path, progress);
      Object.assign(target, next);
      keepInBounds();
    },
    settle() {
      Object.assign(pose, copy(target));
      leaning.x = lean.x;
      leaning.y = lean.y;
    },
    update(dt, aspect, seconds = ease) {
      const k = 1 - Math.exp(-Math.max(dt, 0) / Math.max(seconds, 1e-3));
      const towards = (from: number, to: number) => from + (to - from) * k;
      pose.focus = [0, 1, 2].map((i) =>
        towards(pose.focus[i]!, target.focus[i]!),
      ) as unknown as CameraPose['focus'];
      pose.yaw = towards(pose.yaw, target.yaw);
      pose.pitch = towards(pose.pitch, target.pitch);
      pose.fov = towards(pose.fov, target.fov);
      // Dolly in proportion, so moving in and out feel the same.
      pose.distance = Math.exp(towards(Math.log(pose.distance), Math.log(target.distance)));
      leaning.x = towards(leaning.x, lean.x);
      leaning.y = towards(leaning.y, lean.y);
      return poseCamera(
        {
          ...pose,
          yaw: pose.yaw + leaning.x * sway.yaw,
          pitch: pose.pitch - leaning.y * sway.pitch,
        },
        aspect,
        rig.projection,
      );
    },
  };
  return rig;
}

/** World units the focus moves for a drag across the full canvas height, at a pose. */
export function panScale(pose: CameraPose): number {
  return 2 * pose.distance * Math.tan((pose.fov * Math.PI) / 360);
}
