import type { EffectMeta } from '../types.ts';

export const meta: EffectMeta = {
  id: 'sprite-batch',
  title: 'Sprite batcher',
  epic: '3',
  tier: 'B',
  tags: ['building block', 'sprite', 'sampling', 'msaa'],
  summary:
    'Nine pixel-art sprites and two ground tiles in one instanced draw, with an animated flipbook, a hit flash, three sampling modes and alpha-to-coverage cut-outs.',
  scorecard: {
    compute: false,
    mobile: 'untested',
    flash: 'unmeasured',
    lightPage: 'no',
    features: { required: [] },
    fallback: 'A still of the scene from the default camera.',
    depth: true,
    pixelStability: 'untested',
    useCases: [
      'The way every later effect puts sprites into a scene',
      'A reference for how sampling and cut-out choices look under a moving camera',
    ],
  },
};
