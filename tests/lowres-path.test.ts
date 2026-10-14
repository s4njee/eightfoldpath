import { vec4 } from 'wgpu-matrix';
import { describe, expect, it } from 'vitest';
import {
  pixelCamera,
  snapToPixels,
  virtualSize,
  type PixelCamera,
  type VirtualSize,
} from '../src/gpu/pixel/lowres.ts';
import { TEXEL } from '../src/gpu/sprites/batch.ts';

// Story 3.8: the arithmetic of the low-resolution path. The pictures are checked by
// tests/effects.test.ts and tests/inspect.test.ts, and measured by experiments/lowres-path-study.

describe('virtualSize', () => {
  it('gives the target height at a fractional scale', () => {
    expect(virtualSize(960, 540, 180)).toMatchObject({
      width: 320,
      height: 180,
      scale: 3,
      totalWidth: 324,
      totalHeight: 184,
    });
    const laptop = virtualSize(1366, 768, 180);
    expect(laptop.height).toBe(180);
    expect(laptop.scale).toBeCloseTo(768 / 180, 10);
    expect(laptop.width).toBe(321);
  });

  it('rounds the scale to a whole number when asked, and lands near the target height', () => {
    expect(virtualSize(1366, 768, 180, { integerScale: true })).toMatchObject({
      scale: 4,
      width: 342,
      height: 192,
    });
  });

  it('never scales below one: a small canvas gets a virtual image of its own size', () => {
    expect(virtualSize(48, 32, 180)).toMatchObject({ scale: 1, width: 48, height: 32 });
  });
});

/** Where a world point lands in the virtual image, in virtual pixels from its top-left corner. */
function project(shot: PixelCamera, size: VirtualSize, point: readonly number[]): [number, number] {
  const clip = vec4.transformMat4([point[0]!, point[1]!, point[2]!, 1], shot.camera.viewProj);
  return [
    ((clip[0]! / clip[3]! + 1) / 2) * size.totalWidth,
    ((1 - clip[1]! / clip[3]!) / 2) * size.totalHeight,
  ];
}

const fraction = (value: number) => value - Math.floor(value);
const circular = (a: number, b: number) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b));

describe('pixelCamera', () => {
  const size = virtualSize(960, 540, 180);
  const base = { pitch: 35, yaw: 0.35, fov: 25, size, worldPerPixel: TEXEL };
  const points = [
    [0, 0, 0],
    [1.3, 0.7, -2.1],
    [-3.4, 2.2, 1.9],
  ];
  // A camera gliding across the scene in small, uneven steps.
  const foci = Array.from({ length: 24 }, (_, i) => [i * 0.0137 - 0.1, 1.2, i * 0.0071] as const);

  it('keeps every point on the same sub-pixel phase when orthographic', () => {
    for (const point of points) {
      const phases = foci.map((focus) =>
        project(pixelCamera({ ...base, focus, projection: 'orthographic' }), size, point),
      );
      for (const [x, y] of phases) {
        expect(circular(fraction(x), fraction(phases[0]![0]))).toBeLessThan(1e-3);
        expect(circular(fraction(y), fraction(phases[0]![1]))).toBeLessThan(1e-3);
      }
    }
  });

  it('keeps the focus plane on its phase in perspective, and drifts off it elsewhere', () => {
    // A camera sliding in its own image plane, so the focus plane stays at one depth.
    const { right, up } = pixelCamera({ ...base, focus: [0, 1.2, 0] });
    const slide = foci.map(
      (_, i) =>
        [0, 1, 2].map((k) => [0, 1.2, 0][k]! + right[k]! * i * 0.0137 + up[k]! * i * 0.0091) as [
          number,
          number,
          number,
        ],
    );
    const phases = (point: readonly number[]) =>
      slide.map((focus) => fraction(project(pixelCamera({ ...base, focus }), size, point)[0]));
    const spread = (values: number[]) => Math.max(...values.map((v) => circular(v, values[0]!)));
    // A fixed point on the focus plane, off to one side of the focus.
    const onPlane = [0, 1, 2].map((k) => [0, 1.2, 0][k]! + right[k]! * 1.7 - up[k]! * 0.9);
    expect(spread(phases(onPlane))).toBeLessThan(1e-3);
    // A point well behind it moves at a different rate on screen (parallax), so whole-pixel steps
    // of the camera are not whole pixels there: perspective cannot be snapped everywhere at once.
    expect(spread(phases([0, 0, -8]))).toBeGreaterThan(0.01);
  });

  it('returns the snapped-off motion as an offset that puts every point back', () => {
    for (const projection of ['orthographic', 'perspective'] as const) {
      for (const focus of foci) {
        const snapped = pixelCamera({ ...base, focus, projection });
        const exact = pixelCamera({ ...base, focus, projection, snap: false });
        expect(Math.abs(snapped.offset[0])).toBeLessThanOrEqual(0.5);
        expect(Math.abs(snapped.offset[1])).toBeLessThanOrEqual(0.5);
        expect(exact.offset).toEqual([0, 0]);
        // The upscale shows the snapped image at `screen + offset`, so a point the snapped camera
        // draws at q is seen at q - offset, which must be where the exact camera draws it. In
        // perspective that holds at the focus depth.
        const point =
          projection === 'orthographic' ? points[1]! : [focus[0] + 0.3, focus[1] - 0.2, focus[2]];
        const [qx, qy] = project(snapped, size, point);
        const [tx, ty] = project(exact, size, point);
        const tolerance = projection === 'orthographic' ? 1e-3 : 0.05;
        expect(Math.abs(qx - snapped.offset[0] - tx)).toBeLessThan(tolerance);
        expect(Math.abs(qy - snapped.offset[1] - ty)).toBeLessThan(tolerance);
      }
    }
  });
});

describe('snapToPixels', () => {
  it('puts a standing object on the pixel grid, feet still on the ground', () => {
    const size = virtualSize(960, 540, 180);
    const shot = pixelCamera({
      pitch: 35,
      yaw: 0.35,
      fov: 25,
      size,
      worldPerPixel: TEXEL,
      focus: [0.123, 1.2, -0.456],
      projection: 'orthographic',
    });
    const origin = project(shot, size, [0, 0, 0]);
    for (const position of [
      [0.31, 0, 0.77],
      [-2.05, 0, 1.13],
      [3.3, 0, -2.9],
    ] as const) {
      const snapped = snapToPixels(position, shot, TEXEL);
      expect(snapped[1]).toBe(0);
      expect(Math.hypot(snapped[0] - position[0], snapped[2] - position[2])).toBeLessThan(
        TEXEL * 2,
      );
      const [x, y] = project(shot, size, snapped);
      expect(circular(fraction(x), fraction(origin[0]))).toBeLessThan(1e-3);
      expect(circular(fraction(y), fraction(origin[1]))).toBeLessThan(1e-3);
    }
  });
});
