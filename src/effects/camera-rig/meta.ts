import type { EffectMeta } from '../types.ts';

export const meta: EffectMeta = {
  id: 'camera-rig',
  title: 'Camera rig',
  epic: '4',
  tier: 'B',
  tags: ['building block', 'camera', 'scroll', 'parallax', 'orthographic'],
  summary:
    'The diorama camera and the ways a page moves it: drag to pan, wheel to dolly, a lean toward the pointer, a guided path driven by time or by scrolling, and orthographic projection to compare against.',
  scorecard: {
    compute: false,
    mobile: 'untested',
    flash: 'none',
    lightPage: 'no',
    features: { required: [] },
    fallback: 'A still of the village from the path’s first pose.',
    depth: true,
    // experiments/diorama-stability.test.ts: along the tour the picture pops no more than a
    // supersampled reference, in perspective and orthographic alike.
    pixelStability: 'stable',
    useCases: [
      'A landing page whose diorama moves between places as the visitor scrolls (story 9.1)',
      'An explorable scene: drag and wheel, eased so input never jolts the view',
      'Pointer parallax on any diorama, the cheapest way to make it feel three-dimensional',
    ],
  },
};
