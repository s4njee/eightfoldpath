import type { EffectMeta } from '../types.ts';

export const meta: EffectMeta = {
  id: 'finishing',
  title: 'Finishing: vignette, grain and fringes',
  epic: '5',
  tier: 'B',
  tags: ['lens', 'vignette', 'film grain', 'chromatic aberration', 'post'],
  summary:
    'The last touches before the canvas, all subtle by default: corners a little darker, a fine grain that moves every frame, and colour fringes that grow toward the edges and leave the middle sharp.',
  scorecard: {
    compute: false,
    mobile: 'untested',
    flash: 'none',
    lightPage: 'no',
    features: { required: [] },
    fallback: 'A still of the village square at dusk with the default finishing.',
    depth: true,
    pixelStability: 'untested',
    useCases: [
      'The end of the lens on every diorama scene and hero (Epics 9 and 11)',
      'A filmic finish over any canvas, in the pass that already writes it',
    ],
  },
};
