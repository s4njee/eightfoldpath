import { describe, expect, it } from 'vitest';
import { heroAt, tourProgress, type HeroSection } from '../src/effects/hero-diorama/sections.ts';

const pose = (x: number) => ({
  focus: [x, 0, 0] as const,
  yaw: 0,
  pitch: 35,
  fov: 25,
  distance: 20,
});
const SECTIONS: HeroSection[] = [0, 10, 20].map((x, i) => ({
  name: `s${i}`,
  pose: pose(x),
  subject: [x, 1, 0],
}));

describe('hero choreography (9.1)', () => {
  it('sits on each section at its own progress', () => {
    for (const [i, p] of [0, 0.5, 1].entries()) {
      const frame = heroAt(SECTIONS, p, 0.3);
      expect(frame.pose.focus[0]).toBeCloseTo(i * 10);
      expect(frame.section).toBe(i);
      expect(frame.rack).toBe(0);
    }
  });

  it('holds focus until the rack window, then pulls to the next subject', () => {
    // Between sections 0 and 1 (progress 0 to 0.5), with a rack over the middle 30%.
    const at = (t: number) => heroAt(SECTIONS, t * 0.5, 0.3);
    expect(at(0.3).rack).toBe(0);
    expect(at(0.5).rack).toBeCloseTo(0.5);
    expect(at(0.7).rack).toBe(1);
    expect(at(0.3).from).toBe(0);
    expect(at(0.3).to).toBe(1);
    // A rack of 0 snaps at the midpoint.
    expect(heroAt(SECTIONS, 0.24, 0).rack).toBe(0);
    expect(heroAt(SECTIONS, 0.26, 0).rack).toBe(1);
  });

  it('tours there and back with holds, never jumping', () => {
    // Three sections, hold 2 s, travel 1 s: a leg is 3 s, the cycle 12 s.
    expect(tourProgress(1, 3, 2, 1)).toBe(0);
    expect(tourProgress(2.5, 3, 2, 1)).toBeCloseTo(0.25);
    expect(tourProgress(4, 3, 2, 1)).toBeCloseTo(0.5);
    expect(tourProgress(6.5, 3, 2, 1)).toBeCloseTo(1);
    expect(tourProgress(8.5, 3, 2, 1)).toBeCloseTo(0.75);
    let previous = tourProgress(0, 3, 2, 1);
    for (let s = 0.05; s < 30; s += 0.05) {
      const next = tourProgress(s, 3, 2, 1);
      expect(Math.abs(next - previous)).toBeLessThan(0.06);
      previous = next;
    }
  });
});
