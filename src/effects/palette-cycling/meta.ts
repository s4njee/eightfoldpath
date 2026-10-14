import type { EffectMeta } from '../types.ts';

export const meta: EffectMeta = {
  id: 'palette-cycling',
  title: 'Palette cycling',
  epic: '3',
  tier: 'A',
  tags: ['building block', 'palette', 'animation', 'indexed colour'],
  summary:
    'A waterfall and a lava flow animated the 16-bit way: the art is stored as palette indices and a fragment shader rotates a run of palette entries, so the bands move without a single pixel being redrawn.',
  scorecard: {
    compute: false,
    mobile: 'untested',
    // Measured by tests/flash.test.ts. The palette steps at most five times a second unless the
    // cap is turned off (index.ts explains why steps, not cycles); the uncapped preset goes over.
    flash: 'low',
    flashPresets: ['uncapped (flashes)'],
    lightPage: 'no',
    features: { required: [] },
    fallback: 'A still of both images, or a short looped video of the cycle.',
    depth: false,
    // Drawn at whole-number scales with textureLoad, so texels never resample.
    pixelStability: 'stable',
    useCases: [
      'Water, lava, waterfalls and glowing runes in pixel-art scenes, at almost no cost',
      'Animated backgrounds for a page header that must stay cheap and crisp',
    ],
  },
};
