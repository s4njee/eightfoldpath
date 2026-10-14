import type { EffectMeta } from '../types.ts';

export const meta: EffectMeta = {
  id: 'hello',
  title: 'Hello, diorama',
  epic: '1',
  tier: 'C',
  tags: ['foundation', 'sprite', 'lighting'],
  summary:
    'One pixel-art sprite standing on one tile, lit by an orbiting lantern, through the HDR tail. Exists to exercise the foundation end to end.',
  scorecard: {
    compute: false,
    mobile: 'untested',
    flash: 'unmeasured',
    lightPage: 'untested',
    features: { required: [] },
    fallback: 'A still of the sprite on its tile, or a dark CSS gradient.',
    useCases: [
      'Smoke test for asset loading, the sprite and tile path, depth, lighting and the HDR tail',
      'The starting point for the sprite, lighting and diorama stories in Epics 3 and 4',
    ],
  },
};
