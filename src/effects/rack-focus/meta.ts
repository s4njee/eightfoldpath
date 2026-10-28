import type { EffectMeta } from '../types.ts';

export const meta: EffectMeta = {
  id: 'rack-focus',
  title: 'Rack focus',
  epic: '5',
  tier: 'B',
  tags: ['lens', 'depth of field', 'rack focus', 'scroll', 'pointer', 'post'],
  summary:
    'The tilt-shift lens pulling focus from one character to the next across the village: on a schedule, as the page scrolls, or to whoever is clicked.',
  scorecard: {
    compute: false,
    mobile: 'untested',
    flash: 'none',
    lightPage: 'no',
    features: { required: [] },
    fallback: 'A still of the village focused on the figure on the back terrace.',
    depth: true,
    // The camera holds still and only the blur moves; the gather's noise is fixed to the screen.
    // Not checked with the loupe under a panning camera.
    pixelStability: 'untested',
    useCases: [
      'Scroll stories that move the reader’s eye from one figure to the next',
      'Hero dioramas that answer a click by focusing on what was clicked',
    ],
  },
};
