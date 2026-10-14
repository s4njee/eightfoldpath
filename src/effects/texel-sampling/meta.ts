import type { EffectMeta } from '../types.ts';

export const meta: EffectMeta = {
  id: 'texel-sampling',
  title: 'Texel sampling',
  epic: '3',
  tier: 'B',
  tags: ['building block', 'sampling', 'pixel art', 'mipmaps', 'study'],
  summary:
    'The same panning diorama three times, side by side: nearest, bilinear and sharp sampling of the pixel art, with or without mipmaps. Measured for shimmer and blur at four pixel ratios; sharp sampling is the default for every later effect.',
  scorecard: {
    compute: false,
    mobile: 'untested',
    // Measured by tests/flash.test.ts at the defaults (none): a slow pan changes no area quickly.
    flash: 'none',
    lightPage: 'no',
    features: { required: [] },
    fallback: 'A still of the three columns, which shows the difference without motion.',
    depth: true,
    // It is a comparison: the nearest column shimmers on purpose. The default for later effects
    // (sharp, the right column) popped three to four times less than nearest; see notes.md.
    pixelStability: 'shimmers',
    useCases: [
      'Deciding how a pixel-art scene samples its textures, with numbers behind the choice',
      'Showing why nearest sampling crawls and bilinear blurs once the camera moves',
    ],
  },
};
