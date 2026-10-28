/*
 * The light's path for the pointer-lit sprite (story 9.2): where the portrait sits in its frame,
 * where the pointer puts the light, and where the light drifts when nobody is pointing.
 *
 * Positions are in "frame units": the avatar disc's centre is 0 and its radius is 1, y down like
 * the canvas. Keeping the light there rather than in pixels means a resize or a DPR change moves
 * it with the portrait instead of making it jump.
 */
import { trackPointer } from '../../gpu/pointer.ts';

export type Vec2 = readonly [number, number];

/** The share of the remaining distance covered in `delta` seconds when easing at `rate` per second. */
export function easeFactor(delta: number, rate: number): number {
  return 1 - Math.exp(-Math.max(delta, 0) * Math.max(rate, 0));
}

/**
 * One axis of a pointer position in frame units, with everything beyond the disc's edge pulled in:
 * inside the disc (|d| ≤ 1) the light is exactly under the pointer; outside it keeps going the
 * pointer's way but never goes further than `1 + reach`, so a cursor at the far side of the page
 * still lights the portrait from that side instead of leaving it dark.
 */
export function reachInto(d: number, reach: number): number {
  const a = Math.abs(d);
  if (a <= 1) return d;
  if (reach <= 0) return Math.sign(d);
  return Math.sign(d) * (1 + reach * Math.tanh((a - 1) / reach));
}

export interface Framing {
  /** The sprite's height as a share of the disc's diameter. */
  fill: number;
  /** Where the sprite's bottom edge sits, in frame units below the centre (1 is the disc's foot). */
  bottom: number;
}

export interface PortraitFit {
  /** Canvas pixels per sprite texel. */
  scale: number;
  /** The sprite's top-left corner, in canvas pixels. */
  origin: Vec2;
  /** The disc's centre in canvas pixels, and its radius. */
  centre: Vec2;
  radius: number;
}

/** Places a `size` sprite in the largest disc the canvas holds, as `framing` says. */
export function fitPortrait(
  width: number,
  height: number,
  size: Vec2,
  framing: Framing,
): PortraitFit {
  // A pixel of margin, so the disc's antialiased edge is not cut by the canvas.
  const radius = Math.max(Math.min(width, height) / 2 - 1, 1);
  const centre: Vec2 = [width / 2, height / 2];
  const scale = Math.min(
    (framing.fill * 2 * radius) / size[1],
    // A wide sprite is limited by the disc's width instead.
    (1.9 * radius) / size[0],
  );
  const origin: Vec2 = [
    centre[0] - (size[0] * scale) / 2,
    centre[1] + framing.bottom * radius - size[1] * scale,
  ];
  return { scale, origin, centre, radius };
}

/** A canvas position (0..1 across, possibly outside) in frame units. */
export function toFrame(uv: Vec2, width: number, height: number, fit: PortraitFit): Vec2 {
  return [
    (uv[0] * width - fit.centre[0]) / fit.radius,
    (uv[1] * height - fit.centre[1]) / fit.radius,
  ];
}

/** Where the light goes for a pointer at `uv`: under it inside the disc, pulled in beyond it. */
export function pointerTarget(
  uv: Vec2,
  width: number,
  height: number,
  fit: PortraitFit,
  reach: number,
): Vec2 {
  const p = toFrame(uv, width, height, fit);
  return [reachInto(p[0], reach), reachInto(p[1], reach)];
}

/** A frame-unit position in the sprite's texels (x right, y down, origin at its top-left). */
export function frameToTexel(p: Vec2, fit: PortraitFit): Vec2 {
  return [
    (fit.centre[0] + p[0] * fit.radius - fit.origin[0]) / fit.scale,
    (fit.centre[1] + p[1] * fit.radius - fit.origin[1]) / fit.scale,
  ];
}

/**
 * Where the light drifts with no pointer: a slow, lopsided figure eight over the head, so it
 * spends most of its time above the face (light from above reads as natural) and swings to each
 * side in turn, which is where the automatic normals show the most form.
 */
export function idleLight(time: number, speed: number): Vec2 {
  const t = time * speed;
  return [0.85 * Math.sin(t), -0.55 + 0.3 * Math.sin(2 * t + 0.6)];
}

export type FollowMode = 'page' | 'canvas';

export interface PointerFollow {
  /** The pointer over the canvas (0..1 across, outside that range in page mode), or undefined. */
  position(mode: FollowMode): Vec2 | undefined;
  destroy(): void;
}

/**
 * The pointer, over the canvas only or anywhere on the page. Page mode listens on the window, so
 * a small avatar in a header turns toward a cursor anywhere on screen. A touch lights the portrait
 * while the finger is down (until the browser takes it for a scroll) and lets go when it lifts.
 */
export function followPointer(canvas: HTMLCanvasElement): PointerFollow {
  const local = trackPointer(canvas);
  const page = { x: 0, y: 0, active: false };
  const controller = new AbortController();
  const target = globalThis as unknown as Partial<Window>;
  if (typeof target.addEventListener === 'function') {
    const options = { signal: controller.signal, passive: true };
    const move = (event: PointerEvent) => {
      page.x = event.clientX;
      page.y = event.clientY;
      page.active = true;
    };
    const release = (event: PointerEvent) => {
      if (event.pointerType === 'touch') page.active = false;
    };
    target.addEventListener('pointermove', move, options);
    target.addEventListener('pointerdown', move, options);
    target.addEventListener('pointerup', release, options);
    target.addEventListener('pointercancel', release, options);
    // Leaving the window: `pointerout` with nowhere to go.
    target.addEventListener(
      'pointerout',
      (event: PointerEvent) => {
        if (!event.relatedTarget) page.active = false;
      },
      options,
    );
  }
  return {
    position(mode) {
      if (local.state.inside) return [local.state.x, local.state.y];
      if (mode !== 'page' || !page.active) return undefined;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return undefined;
      return [(page.x - rect.left) / rect.width, (page.y - rect.top) / rect.height];
    },
    destroy() {
      controller.abort();
      local.destroy();
    },
  };
}
