import type { GradeArea, GradeLook } from '../../gpu/post-fx/grade.ts';

/*
 * The village's looks (story 5.7): one per time of day and one per area, applied in that order.
 * The areas follow the scene's bands of ground (assets/scenes/village.json, 24 x 16 cells): the
 * upper terrace and the road north, the cobbled square with the lanterns, and the lower lane and
 * shore. Exported for any effect that stages something in the village (9.1's hero among them).
 */

export const TIMES_OF_DAY = ['day', 'dusk', 'night'] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

export const TIME_LOOKS: Readonly<Record<TimeOfDay, GradeLook>> = {
  // Close to neutral: a touch warm and crisp.
  day: { temperature: 0.06, contrast: 1.04, saturation: 1.05 },
  // Amber highlights over violet shadows, the colour drained a little.
  dusk: {
    exposure: -0.2,
    temperature: 0.45,
    tint: 0.1,
    contrast: 1.1,
    saturation: 0.9,
    shadows: [0.35, 0.18, 0.6],
    shadowAmount: 0.8,
    highlights: [1, 0.55, 0.25],
    highlightAmount: 0.8,
  },
  // Moonlight: cool, low in colour, a little lifted in the blacks so the shapes still read.
  night: {
    exposure: -0.45,
    temperature: -0.5,
    contrast: 1.1,
    saturation: 0.5,
    fade: 0.04,
    shadows: [0.15, 0.25, 0.7],
    shadowAmount: 0.7,
    highlights: [0.75, 0.85, 1],
    highlightAmount: 0.25,
  },
};

/** How the stage lights the village at each time of day. */
export const TIME_LIGHT: Readonly<
  Record<
    TimeOfDay,
    { sunElevation: number; sunAzimuth: number; sunIntensity: number; exposure: number }
  >
> = {
  day: { sunElevation: 38, sunAzimuth: 0.75, sunIntensity: 1.25, exposure: 1 },
  dusk: { sunElevation: 9, sunAzimuth: -1.2, sunIntensity: 0.9, exposure: 1.1 },
  night: { sunElevation: 30, sunAzimuth: 2.4, sunIntensity: 0.25, exposure: 1.4 },
};

export const VILLAGE_AREAS: readonly (GradeArea & { focus: readonly [number, number, number] })[] =
  [
    { name: 'the road on', min: [0, 0], max: [24, 7.5], focus: [11, 4.2, 3.8] },
    { name: 'the square', min: [0, 7.5], max: [24, 12], focus: [10.8, 2.4, 9.6] },
    { name: 'the shore', min: [0, 12], max: [24, 16], focus: [12, 0.8, 12.8] },
  ];

export const AREA_LOOKS: Readonly<Record<string, GradeLook>> = {
  // Open meadow: lusher greens, a cooler tint.
  'the road on': {
    saturation: 1.15,
    tint: -0.12,
    highlights: [0.85, 1, 0.6],
    highlightAmount: 0.2,
  },
  // Lamplight on stone: warmer and a little more contrast.
  'the square': {
    temperature: 0.12,
    contrast: 1.06,
    highlights: [1, 0.75, 0.45],
    highlightAmount: 0.3,
  },
  // Sea air: paler, softer, cyan in the shadows.
  'the shore': {
    temperature: -0.1,
    saturation: 0.85,
    fade: 0.03,
    contrast: 0.95,
    shadows: [0.2, 0.6, 0.7],
    shadowAmount: 0.45,
  },
};
