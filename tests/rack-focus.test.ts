import { describe, expect, it } from 'vitest';
import { poseCamera } from '../src/gpu/diorama/rig.ts';
import {
  createRackFocus,
  hermite,
  pickSubject,
  scheduledSubject,
  scrolledSubject,
} from '../src/gpu/lens/rack-focus.ts';
import { viewDistance } from '../src/gpu/lens/tilt-shift.ts';

// The rack-focus driver (story 5.3): plain arithmetic, so every expectation is exact.

/** Runs `seconds` of frames at 60 a second and returns the distance after each. */
function run(focus: ReturnType<typeof createRackFocus>, seconds: number, reduced = false) {
  const out: number[] = [];
  for (let i = 0; i < Math.round(seconds * 60); i++) out.push(focus.update(1 / 60, reduced));
  return out;
}

describe('rack focus easing', () => {
  it('jumps to the first target, then racks to the next over exactly `duration`', () => {
    const focus = createRackFocus({ duration: 1 });
    focus.rackTo(20, 'a');
    expect(focus.update(1 / 60)).toBe(20);
    focus.rackTo(30, 'b');
    expect(focus.moving).toBe(true);
    const path = run(focus, 1);
    // Half-way through a rack from rest is half-way there (a smoothstep), and it ends on time.
    expect(path[29]).toBeCloseTo(25, 6);
    expect(path[59]).toBe(30);
    expect(focus.moving).toBe(false);
    // Eases in and out: slow at both ends, fastest in the middle, never past the target.
    const steps = path.map((d, i) => d - (path[i - 1] ?? 20));
    expect(steps[0]!).toBeLessThan(steps[29]!);
    expect(steps[58]!).toBeLessThan(steps[29]!);
    expect(Math.max(...path)).toBeLessThanOrEqual(30);
    expect(steps.every((s) => s >= 0)).toBe(true);
  });

  it('keeps its speed when retargeted half-way, with no jerk', () => {
    const focus = createRackFocus({ duration: 1, initial: 10 });
    focus.rackTo(30, 'far');
    const before = run(focus, 0.5);
    focus.rackTo(0, 'near');
    const after = run(focus, 1);
    // Still moving outwards for a moment, then back, with no jump at the switch.
    const v0 = before[29]! - before[28]!;
    const v1 = after[0]! - before[29]!;
    expect(Math.abs(v1 - v0)).toBeLessThan(Math.abs(v0) * 0.2);
    expect(after[59]).toBe(0);
  });

  it('follows a moving subject with the same key, without restarting the rack', () => {
    const focus = createRackFocus({ duration: 2, initial: 10 });
    focus.rackTo(20, 'knight');
    run(focus, 2);
    expect(focus.distance).toBe(20);
    // The camera moves, so the knight's distance changes: followed at once at rest.
    focus.rackTo(21, 'knight');
    expect(focus.distance).toBe(21);
    expect(focus.moving).toBe(false);
    // The default key is the distance itself, so a new number is a new rack.
    focus.rackTo(25);
    expect(focus.moving).toBe(true);
  });

  it('jumps instead of racking under reduced motion, or with no duration', () => {
    const focus = createRackFocus({ duration: 1, initial: 10 });
    focus.rackTo(30, 1);
    expect(focus.update(1 / 60, true)).toBe(30);
    expect(focus.moving).toBe(false);
    const instant = createRackFocus({ duration: 0, initial: 10 });
    instant.rackTo(30, 1);
    expect(instant.distance).toBe(30);
    const jumped = createRackFocus({ duration: 1, initial: 10 });
    jumped.jump(18);
    expect(jumped.update(1 / 60)).toBe(18);
  });

  it('runs the curve from the start to the target, at rest at the end', () => {
    expect(hermite(2, 0, 8, 0)).toBe(2);
    expect(hermite(2, 0, 8, 1)).toBe(8);
    expect(hermite(2, 0, 8, 0.5)).toBe(5);
    expect(hermite(2, 5, 8, 1.5)).toBe(8);
  });
});

describe('choosing the subject', () => {
  it('holds each subject in turn, looping, and splits the scroll evenly', () => {
    expect([0, 3.9, 4, 8, 11.9, 12].map((t) => scheduledSubject(t, 3, 4))).toEqual([
      0, 0, 1, 2, 2, 0,
    ]);
    expect(scheduledSubject(5, 1, 4)).toBe(0);
    expect([0, 0.32, 0.34, 0.99, 1, 2, -1].map((p) => scrolledSubject(p, 3))).toEqual([
      0, 0, 1, 2, 2, 2, 0,
    ]);
  });

  it('picks the subject drawn nearest the pointer, and its focus distance is its own', () => {
    const camera = poseCamera(
      { focus: [12, 2, 8.5], yaw: 0, pitch: 35, fov: 25, distance: 52 },
      16 / 9,
      'perspective',
    );
    const subjects = [
      [12, 2, 8.5],
      [6, 2, 8.5],
      [12, 4, 2],
    ] as const;
    const size = [1600, 900] as const;
    // The camera's focus point is drawn in the middle of the canvas.
    expect(pickSubject(camera, subjects, { x: 0.5, y: 0.5 }, size)).toBe(0);
    expect(pickSubject(camera, subjects, { x: 0.52, y: 0.5 }, size)).toBe(0);
    // Left of the middle, and further back up the frame.
    expect(pickSubject(camera, subjects, { x: 0.35, y: 0.5 }, size)).toBe(1);
    expect(pickSubject(camera, subjects, { x: 0.5, y: 0.25 }, size, 200)).toBe(2);
    expect(pickSubject(camera, subjects, { x: 0.95, y: 0.95 }, size)).toBeUndefined();
    expect(viewDistance(camera, subjects[0])).toBeCloseTo(52, 4);
    expect(viewDistance(camera, subjects[2])).toBeGreaterThan(52);
  });
});
