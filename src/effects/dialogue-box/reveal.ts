import { PUNCTUATION_PAUSES } from '../../gpu/text/layout.ts';

/*
 * The dialogue box's clock (story 9.5), kept apart from the DOM and the GPU so it can be tested.
 *
 * The reveal runs on the same clock as the bitmap font's typewriter (src/gpu/text/layout.ts): one
 * unit per character, with the same extra pause after punctuation, so a sentence breathes at its
 * full stop whether it is drawn in pixels or typed into HTML. The schedule is in UTF-16 offsets,
 * because that is what a DOM Range counts in.
 */

export interface RevealSchedule {
  readonly text: string;
  /** For each character (code point), when it appears, in characters of typewriter time. */
  readonly order: readonly number[];
  /** For each character, the UTF-16 offset just after it. */
  readonly ends: readonly number[];
  /** Typewriter time until the last character shows, pauses included. */
  readonly duration: number;
}

export function revealSchedule(text: string, pauses = true): RevealSchedule {
  const order: number[] = [];
  const ends: number[] = [];
  let clock = 0;
  let offset = 0;
  for (const char of text) {
    order.push(clock);
    offset += char.length;
    ends.push(offset);
    clock += 1 + (pauses ? (PUNCTUATION_PAUSES[char] ?? 0) : 0);
  }
  return { text, order, ends, duration: order.length > 0 ? order.at(-1)! + 1 : 0 };
}

/** How many UTF-16 code units of the text are shown at `clock`: a prefix, never half a pair. */
export function revealedLength(schedule: RevealSchedule, clock: number): number {
  // The characters shown are those whose order is below the clock; order only grows.
  let lo = 0;
  let hi = schedule.order.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (schedule.order[mid]! < clock) lo = mid + 1;
    else hi = mid;
  }
  return lo === 0 ? 0 : schedule.ends[lo - 1]!;
}

export interface DialogueSettings {
  /** Characters a second. */
  speed: number;
  /** Seconds a finished page stays before the next one; 0 waits for the reader. */
  hold: number;
  /** False under reduced motion, or with the typewriter off: every page is shown whole. */
  animate: boolean;
}

export type Advance = 'finished' | 'next';

/** Which page is up and how much of it shows. `tick` from the frame loop, `advance` on input. */
export interface DialogueState {
  readonly page: number;
  readonly schedule: RevealSchedule;
  /** Typewriter time into the page, in characters (the bitmap font's `order` counts the same). */
  readonly clock: number;
  /** UTF-16 code units shown. */
  revealed(settings: DialogueSettings): number;
  complete(settings: DialogueSettings): boolean;
  tick(seconds: number, settings: DialogueSettings): void;
  /** Finishes the page if it is still typing, otherwise turns to the next (the last wraps round). */
  advance(settings: DialogueSettings): Advance;
}

export function createDialogueState(pages: readonly string[]): DialogueState {
  if (pages.length === 0) throw new Error('A dialogue needs at least one page');
  const schedules = pages.map((page) => revealSchedule(page));
  let page = 0;
  let clock = 0;
  let held = 0;
  const complete = (settings: DialogueSettings) =>
    !settings.animate || clock >= schedules[page]!.duration;
  const turn = () => {
    page = (page + 1) % pages.length;
    clock = 0;
    held = 0;
  };

  return {
    get page() {
      return page;
    },
    get schedule() {
      return schedules[page]!;
    },
    get clock() {
      return clock;
    },
    revealed: (settings) =>
      complete(settings) ? pages[page]!.length : revealedLength(schedules[page]!, clock),
    complete,
    tick(seconds, settings) {
      if (!settings.animate) return;
      if (clock < schedules[page]!.duration) {
        clock = Math.min(clock + seconds * settings.speed, schedules[page]!.duration);
        return;
      }
      if (settings.hold <= 0) return;
      held += seconds;
      if (held >= settings.hold) turn();
    },
    advance(settings) {
      if (!complete(settings)) {
        clock = schedules[page]!.duration;
        held = 0;
        return 'finished';
      }
      turn();
      return 'next';
    },
  };
}

/**
 * The "next" marker's bounce, in whole texels above its rest position: up two and back over a
 * second, one texel at a time so it never blurs between rows. Still when motion is off.
 */
export function markerBounce(seconds: number, animate: boolean): number {
  if (!animate) return 0;
  const steps = [0, 0, 1, 2, 2, 1] as const;
  return steps[Math.floor(seconds * steps.length) % steps.length]!;
}
