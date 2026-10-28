import type { EffectMeta } from '../types.ts';

export const meta: EffectMeta = {
  id: 'hero-diorama',
  title: 'Hero diorama',
  epic: '9',
  tier: 'B',
  tags: ['web', 'hero', 'scroll', 'rack focus', 'tilt-shift', 'diorama'],
  summary:
    'The village behind a landing-page hero: scrolling through the page moves the camera from place to place and racks the tilt-shift lens from one section’s subject to the next.',
  scorecard: {
    compute: false,
    mobile: 'untested',
    // The moving camera carries edges across the analyser's cells: one transition a second in one
    // cell at most, nothing over a large area (tests/flash.test.ts).
    flash: 'low',
    lightPage: 'no',
    features: { required: [] },
    fallback: 'A still of each section’s pose, swapped as the page scrolls, or the first alone.',
    depth: true,
    pixelStability: 'untested',
    useCases: [
      'A landing page told in sections, the scene moving with the story',
      'Product tours and portfolios where each section has one thing to look at',
    ],
  },
};
