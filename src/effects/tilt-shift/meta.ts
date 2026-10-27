import type { EffectMeta } from '../types.ts';

export const meta: EffectMeta = {
  id: 'tilt-shift',
  title: 'Tilt-shift depth of field',
  epic: '5',
  tier: 'B',
  tags: ['lens', 'depth of field', 'tilt-shift', 'gather', 'post'],
  summary:
    'The miniature look: a half-resolution gather depth of field with separate near and far fields and a focus band, against a screen-space blur that grows away from a horizontal line and needs no depth.',
  scorecard: {
    compute: false,
    mobile: 'untested',
    flash: 'none',
    lightPage: 'no',
    features: { required: [] },
    fallback: 'A still of the village through the default depth lens.',
    depth: true,
    // The camera holds still; the gather's per-pixel noise is fixed to the screen, so a still frame
    // is stable. Under a panning camera it has not been checked through the loupe.
    pixelStability: 'untested',
    useCases: [
      'The lens over every diorama scene and hero (Epics 9 and 11)',
      'A depth-free tilt-shift for flat layers, images and compat devices (the screen method)',
    ],
  },
};
