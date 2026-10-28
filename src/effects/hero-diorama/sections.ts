/*
 * Story 9.1's choreography, as plain arithmetic: a landing page in sections, each with a camera
 * pose and a subject to focus on. Scrolling (or the clock) gives a progress from 0 to 1 through the
 * sections; the camera moves along a path through the poses (src/gpu/diorama/rig.ts) and the focus
 * holds on one section's subject, then racks to the next one's partway between them, the way a
 * camera operator pulls focus once the new subject is in frame.
 */
import { poseOnPath, type PathKey } from '../../gpu/diorama/rig.ts';
import type { CameraPose } from '../../gpu/diorama/scene.ts';

export interface HeroSection {
  /** Shown in the HUD. */
  name: string;
  pose: CameraPose;
  /** World point to hold in focus while this section is on screen. */
  subject: readonly [number, number, number];
}

export interface HeroFrame {
  pose: CameraPose;
  /** The two subjects the focus is between, and how far it has racked from `from` to `to`, 0..1. */
  from: number;
  to: number;
  rack: number;
  /** The section the page is in: the nearest one. */
  section: number;
}

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
const smoothstep = (t: number) => t * t * (3 - 2 * t);

/** Path keys for the sections, evenly spaced from 0 to 1. */
export function sectionKeys(sections: readonly HeroSection[]): PathKey[] {
  const last = Math.max(sections.length - 1, 1);
  return sections.map((section, i) => ({ ...section.pose, at: i / last }));
}

/**
 * Where the camera is and what it focuses on, `progress` of the way through the sections. `rack` is
 * the share of the way between two sections over which the focus pulls, centred on the midpoint:
 * 0 snaps at the midpoint, 1 racks the whole way.
 */
export function heroAt(
  sections: readonly HeroSection[],
  progress: number,
  rack: number,
): HeroFrame {
  const keys = sectionKeys(sections);
  const span = Math.max(sections.length - 1, 1);
  const p = clamp01(progress) * span;
  const from = Math.min(Math.floor(p), sections.length - 1);
  const to = Math.min(from + 1, sections.length - 1);
  const t = p - from;
  const width = Math.max(rack, 1e-3);
  return {
    pose: poseOnPath(keys, clamp01(progress)),
    from,
    to,
    rack: from === to ? 0 : smoothstep(clamp01((t - (0.5 - width / 2)) / width)),
    section: Math.round(p),
  };
}

/**
 * Progress through the sections on the clock: hold on each for `hold` seconds, travel to the next
 * in `travel`, then come back the other way, so the tour never jumps from the last to the first.
 */
export function tourProgress(seconds: number, count: number, hold: number, travel: number): number {
  const legs = Math.max(count - 1, 1);
  const leg = hold + travel;
  const cycle = legs * leg * 2;
  const s = ((seconds % cycle) + cycle) % cycle;
  const forward = s < cycle / 2;
  const within = forward ? s : s - cycle / 2;
  const index = Math.floor(within / leg);
  const moving = clamp01((within - index * leg - hold) / Math.max(travel, 1e-3));
  const position = (index + moving) / legs;
  return forward ? position : 1 - position;
}
