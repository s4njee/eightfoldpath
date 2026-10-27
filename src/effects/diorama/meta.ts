import type { EffectMeta } from '../types.ts';

export const meta: EffectMeta = {
  id: 'diorama',
  title: 'Diorama',
  epic: '4',
  tier: 'B',
  tags: ['building block', 'scene', 'terrain', 'tiles', 'stairs', 'shadows'],
  summary:
    'A village of terraces, stairs and a ramp, written by hand as rows of characters and extruded into blocks in one draw call, with sprites standing on it under a sun, sky and two lamps.',
  scorecard: {
    compute: false,
    mobile: 'untested',
    flash: 'none',
    lightPage: 'no',
    features: { required: [] },
    fallback: 'A still of the village from the default camera.',
    depth: true,
    // experiments/diorama-stability.test.ts: under a fast sway at 1280 × 720 the picture pops no
    // more than a supersampled reference (2.24 against 2.17). At 640 × 360, where a texel is about
    // a pixel, it pops twice as much.
    pixelStability: 'stable',
    useCases: [
      'The ground every diorama effect stands on (Epics 5, 6, 7 and 11)',
      'A small explorable place behind a landing page, written by hand rather than modelled',
    ],
  },
};
