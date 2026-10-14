import type { EffectMeta } from '../types.ts';

export const meta: EffectMeta = {
  id: 'sprite-lighting',
  title: 'Sprite lighting',
  epic: '3',
  tier: 'B',
  tags: ['building block', 'sprite', 'lighting', 'normals', 'palette'],
  summary:
    'Flat, relief-mapped and automatic normals side by side under the same moving lights: normals generated from each sprite’s alpha, a rim light, and light quantised into bands or snapped to the palette.',
  scorecard: {
    compute: false,
    mobile: 'untested',
    flash: 'low',
    lightPage: 'no',
    features: { required: [] },
    fallback: 'A still of the three columns from the default camera.',
    depth: true,
    // The camera does not move by default; nobody has watched a yaw change through the loupe.
    pixelStability: 'untested',
    useCases: [
      'The lighting every lit sprite in later scenes uses',
      'Giving existing sprite art a normal map without painting one',
      'A pointer-lit portrait or avatar (story 9.2)',
    ],
  },
};
