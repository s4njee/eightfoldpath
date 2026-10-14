import type { EffectMeta } from '../types.ts';

export const meta: EffectMeta = {
  id: 'texel-lighting',
  title: 'Texel-snapped lighting',
  epic: '3',
  tier: 'B',
  tags: ['building block', 'lighting', 'shadows', 'pixel art'],
  summary:
    'A floating lantern circling a few sprites on cobbles and grass, its light and shadow evaluated at the centre of each texel rather than each pixel, so every light edge follows the pixel-art grid.',
  scorecard: {
    compute: false,
    mobile: 'untested',
    // tests/flash.test.ts measures one small cell changing once as the lamp passes: low.
    flash: 'low',
    lightPage: 'no',
    features: { required: [] },
    fallback: 'A still of the lamp-lit scene.',
    depth: true,
    // The camera does not move; the light does. With the light moving, whole texels change step
    // at once, which is the intended look; nobody has checked a moving camera through the loupe.
    pixelStability: 'untested',
    useCases: [
      'Lighting pixel art so light and shadow edges stay on the art’s grid',
      'Any lit sprite or tile scene in later epics, as a shade chunk for the sprite batcher',
    ],
  },
};
