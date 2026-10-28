import type { EffectMeta } from '../types.ts';

export const meta: EffectMeta = {
  id: 'bokeh-highlights',
  title: 'Bokeh highlights',
  epic: '5',
  tier: 'B',
  tags: ['lens', 'depth of field', 'bokeh', 'aperture', 'compute', 'post'],
  summary:
    'The village at night through the tilt-shift lens, its blurred lanterns drawn as discs the shape of the aperture: round, bladed, soap-bubble or cat’s-eye toward the edges.',
  scorecard: {
    compute: true,
    mobile: 'untested',
    flash: 'none',
    lightPage: 'no',
    features: { required: [] },
    fallback: 'A still of the night village through the lens, with hexagonal bokeh.',
    depth: true,
    // Still camera; the discs come from the sharp image, so they hold still with it. Not checked
    // with the loupe under a panning camera.
    pixelStability: 'untested',
    useCases: [
      'Night and dusk heroes: lanterns, windows, torches and fireflies out of focus',
      'Any page already using the depth lens, for the price of a compute pass and a few thousand small sprites',
    ],
  },
};
