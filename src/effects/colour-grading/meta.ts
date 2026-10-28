import type { EffectMeta } from '../types.ts';

export const meta: EffectMeta = {
  id: 'colour-grading',
  title: 'Colour grading',
  epic: '5',
  tier: 'B',
  tags: ['lens', 'colour grading', 'lookup table', 'time of day', 'post'],
  summary:
    'A look for each time of day and each part of the village, baked into 3D lookup tables and crossfaded as the camera moves from the square to the road or the shore, and as the sun goes down.',
  scorecard: {
    compute: false,
    mobile: 'untested',
    flash: 'low',
    lightPage: 'no',
    features: { required: [] },
    fallback: 'A still of the village square at dusk, graded.',
    depth: true,
    pixelStability: 'untested',
    useCases: [
      'Time of day and a sense of place on every diorama scene (Epics 9 and 11)',
      'A brand look over any canvas: one table, one texture lookup per pixel',
    ],
  },
};
