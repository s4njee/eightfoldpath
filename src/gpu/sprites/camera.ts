// Cameras for diorama scenes: what the sprite batcher and the scene passes need to draw.
import { mat4, vec3, type Mat4 } from 'wgpu-matrix';

export interface CameraState {
  readonly viewProj: Mat4;
  readonly view: Mat4;
  readonly projection: Mat4;
  readonly eye: readonly [number, number, number];
  /** World-space right and up, for building billboards. */
  readonly right: readonly [number, number, number];
  readonly up: readonly [number, number, number];
  readonly forward: readonly [number, number, number];
}

export interface DioramaCameraOptions {
  /** Degrees below the horizon. plan.md's default is about 35. */
  pitch: number;
  /** Radians about the vertical axis; 0 looks along -z. */
  yaw: number;
  /** Vertical field of view in degrees. plan.md's default is about 25. */
  fov: number;
  focus: readonly [number, number, number];
  distance: number;
  aspect: number;
  near?: number;
  far?: number;
}

function state(view: Mat4, projection: Mat4, eye: readonly number[]): CameraState {
  const inverse = mat4.inverse(view);
  const triple = (column: number) =>
    [inverse[column * 4]!, inverse[column * 4 + 1]!, inverse[column * 4 + 2]!] as const;
  const back = triple(2);
  return {
    viewProj: mat4.multiply(projection, view),
    view,
    projection,
    eye: [eye[0]!, eye[1]!, eye[2]!],
    right: triple(0),
    up: triple(1),
    forward: [-back[0], -back[1], -back[2]],
  };
}

/** The narrow, pitched-down perspective camera of plan.md's camera decision. */
export function dioramaCamera(options: DioramaCameraOptions): CameraState {
  const pitch = (options.pitch * Math.PI) / 180;
  const eye = vec3.add(options.focus, [
    Math.sin(options.yaw) * Math.cos(pitch) * options.distance,
    Math.sin(pitch) * options.distance,
    Math.cos(options.yaw) * Math.cos(pitch) * options.distance,
  ]);
  const view = mat4.lookAt(eye, options.focus, [0, 1, 0]);
  const projection = mat4.perspective(
    (options.fov * Math.PI) / 180,
    options.aspect,
    options.near ?? 0.1,
    options.far ?? 200,
  );
  return state(view, projection, [eye[0]!, eye[1]!, eye[2]!]);
}

/** The distance at which a camera with this field of view frames `height` world units. */
export function framingDistance(fovDegrees: number, height: number): number {
  return height / 2 / Math.tan((fovDegrees * Math.PI) / 360);
}

/**
 * An orthographic camera looking along `direction` at `center`, covering a square `extent` world
 * units across: a directional light's view for a shadow map (story 3.4).
 */
export function orthographicCamera(
  direction: readonly [number, number, number],
  center: readonly [number, number, number],
  extent: number,
  depth = extent * 4,
): CameraState {
  const dir = vec3.normalize(direction);
  const eye = vec3.subtract(center, vec3.scale(dir, depth / 2));
  const up = Math.abs(dir[1]!) > 0.99 ? [0, 0, 1] : [0, 1, 0];
  const view = mat4.lookAt(eye, center, up);
  const half = extent / 2;
  const projection = mat4.ortho(-half, half, -half, half, 0, depth);
  return state(view, projection, [eye[0]!, eye[1]!, eye[2]!]);
}
