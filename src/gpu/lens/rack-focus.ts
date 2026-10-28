/*
 * Rack focus (story 5.3): the focus distance pulled from one subject to another, as a camera's
 * focus puller does, driven by the time, the page's scroll or the subject a visitor points at.
 *
 *   const focus = createRackFocus({ duration: 1.2 });
 *   frame(time) {
 *     const i = scheduledSubject(time.time, subjects.length, 4);     // or scrolledSubject(progress, n)
 *     // or, on a click: i = pickSubject(camera, subjects, pointer, [width, height]) ?? i
 *     focus.rackTo(viewDistance(camera, subjects[i]), i);            // the subject's distance, its key
 *     lens.encode(..., { ...settings, focusDistance: focus.update(time.delta, reducedMotion) });
 *   }
 *
 * The module is plain state and arithmetic, with no DOM and no GPU, so it drives any lens setting
 * that is a distance (the tilt-shift lens's `focusDistance`, a layer lens's focus) from anything.
 *
 *   createRackFocus({ duration?, initial? })  a driver; `duration` is seconds per rack (default 1).
 *   rackTo(distance, key?)  where the focus is heading. A new `key` (by default the distance itself)
 *                           starts a rack of `duration` seconds from where the focus is now, at the
 *                           speed it is moving; the same key only moves the end, so a subject that
 *                           moves, or a camera that does, is followed without restarting the rack.
 *   jump(distance, key?)    there at once, with no rack.
 *   update(dt, reduced?)    advances by `dt` seconds and returns the focus distance. With `reduced`
 *                           (prefers-reduced-motion) every rack is a jump. The first call after
 *                           creation jumps too, unless `initial` was given.
 *   distance, target, key, moving   the state, read-only.
 *
 * and three ways of choosing the subject, which return an index into the caller's list:
 *
 *   scheduledSubject(time, count, hold)        each subject in turn for `hold` seconds, looping.
 *   scrolledSubject(progress, count)           the scroll progress (0..1, the rig's
 *                                              `scrollProgress`) split evenly among the subjects.
 *   pickSubject(camera, points, pointer, size, radius?)   the subject drawn nearest the pointer
 *                                              (0..1 across the canvas), within `radius` pixels.
 *
 * A rack is a cubic Hermite curve from the current distance and speed to the target at rest, so it
 * eases in and out like a smoothstep when it starts from rest and never jerks when retargeted
 * halfway. `viewDistance` (src/gpu/lens/tilt-shift.ts) turns a world point into a focus distance.
 */

export interface RackFocusOptions {
  /** Seconds a rack takes. Default 1. */
  duration?: number;
  /** The starting distance. Without it the first `update` jumps to the first target. */
  initial?: number;
}

export interface RackFocus {
  /** The focus distance now. */
  readonly distance: number;
  /** Where the focus is heading. */
  readonly target: number;
  /** What the target is (a subject's index, say), as given to `rackTo`. */
  readonly key: unknown;
  /** True while a rack is under way. */
  readonly moving: boolean;
  /** Seconds a rack takes; read when a rack starts. */
  duration: number;
  rackTo(distance: number, key?: unknown): void;
  jump(distance: number, key?: unknown): void;
  update(dt: number, reducedMotion?: boolean): number;
}

/** The cubic Hermite curve from `p0` moving at `v0` (units per unit `s`) to `p1` at rest, at `s`. */
export function hermite(p0: number, v0: number, p1: number, s: number): number {
  const t = Math.min(Math.max(s, 0), 1);
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * v0 + (3 * t2 - 2 * t3) * p1;
}

/** The slope of `hermite` in `s`. */
function hermiteSlope(p0: number, v0: number, p1: number, s: number): number {
  const t = Math.min(Math.max(s, 0), 1);
  const t2 = t * t;
  return (6 * t2 - 6 * t) * p0 + (3 * t2 - 4 * t + 1) * v0 + (6 * t - 6 * t2) * p1;
}

export function createRackFocus(options: RackFocusOptions = {}): RackFocus {
  let started = options.initial !== undefined;
  let distance = options.initial ?? 0;
  let target = distance;
  let key: unknown = undefined;
  // The rack under way: from `from` at speed `speed` (world units per second) to `target`.
  let from = distance;
  let speed = 0;
  let elapsed = 0;
  let length = 0;
  let moving = false;

  /** Speed now, world units per second. */
  function currentSpeed(): number {
    if (!moving || length <= 0) return 0;
    return hermiteSlope(from, speed * length, target, elapsed / length) / length;
  }

  const rack: RackFocus = {
    get distance() {
      return distance;
    },
    get target() {
      return target;
    },
    get key() {
      return key;
    },
    get moving() {
      return moving;
    },
    duration: Math.max(options.duration ?? 1, 0),
    rackTo(next, nextKey = next) {
      if (started && Object.is(nextKey, key)) {
        // The same subject: follow it, keeping the rack's timing.
        target = next;
        if (!moving) distance = next;
        return;
      }
      key = nextKey;
      if (!started) {
        rack.jump(next, nextKey);
        return;
      }
      speed = currentSpeed();
      from = distance;
      target = next;
      elapsed = 0;
      length = rack.duration;
      moving = length > 0 && from !== target;
      if (!moving) distance = target;
    },
    jump(next, nextKey = next) {
      started = true;
      key = nextKey;
      distance = from = target = next;
      speed = 0;
      moving = false;
    },
    update(dt, reducedMotion = false) {
      if (!started) return distance;
      if (reducedMotion || !moving) {
        distance = target;
        moving = false;
        return distance;
      }
      elapsed += Math.max(dt, 0);
      // A whole number of frames can sum to a hair under the duration.
      if (elapsed >= length - 1e-6) {
        distance = target;
        moving = false;
      } else {
        distance = hermite(from, speed * length, target, elapsed / length);
      }
      return distance;
    },
  };
  return rack;
}

/** Which of `count` subjects is in focus at `time` seconds, each held for `hold`, looping. */
export function scheduledSubject(time: number, count: number, hold: number): number {
  if (count <= 1 || hold <= 0) return 0;
  const n = Math.floor(Math.max(time, 0) / hold);
  return n % count;
}

/** Which of `count` subjects a scroll progress (0..1) falls on: the page split evenly. */
export function scrolledSubject(progress: number, count: number): number {
  if (count <= 1) return 0;
  const p = Math.min(Math.max(progress, 0), 1);
  return Math.min(Math.floor(p * count), count - 1);
}

/**
 * The subject drawn nearest the pointer, or undefined if none is within `radius` pixels.
 * `pointer` is 0..1 across and down the canvas, `size` the canvas in pixels; subjects behind the
 * camera are skipped.
 */
export function pickSubject(
  camera: { viewProj: ArrayLike<number> },
  points: readonly (readonly [number, number, number])[],
  pointer: { x: number; y: number },
  size: readonly [number, number],
  radius = 48,
): number | undefined {
  const m = camera.viewProj;
  let best: number | undefined;
  let bestDistance = radius;
  points.forEach(([x, y, z], i) => {
    // Column-major: clip = M · (x, y, z, 1).
    const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
    if (w <= 0) return;
    const sx = ((m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w) * 0.5 + 0.5;
    const sy = 0.5 - ((m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w) * 0.5;
    const d = Math.hypot((sx - pointer.x) * size[0], (sy - pointer.y) * size[1]);
    if (d <= bestDistance) {
      bestDistance = d;
      best = i;
    }
  });
  return best;
}
