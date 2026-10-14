import type { EffectMeta } from '../types.ts';

export const meta: EffectMeta = {
  id: 'sprite-shadows',
  title: 'Sprite shadows',
  epic: '3',
  tier: 'B',
  tags: ['building block', 'sprite', 'shadows', 'shadow map', 'pcf'],
  summary:
    'Four ways to give a flat sprite a shadow under a moving sun: a blob, a billboard turned toward the light in the shadow pass, crossed quads, and the silhouette projected onto the ground, received with PCF.',
  scorecard: {
    compute: false,
    mobile: 'untested',
    flash: 'none',
    lightPage: 'no',
    features: { required: [] },
    fallback: 'A still of the diorama with the default light-facing shadows.',
    depth: true,
    // The sun moves, the camera does not; shadow-edge crawl under a moving sun was looked at in
    // still frames only, not through the loupe.
    pixelStability: 'untested',
    useCases: [
      'The shadow every sprite in a lit diorama casts (Epics 4, 6 and 11)',
      'Choosing a cheaper shadow where a shadow map is too much (blobs on phones)',
    ],
  },
};
