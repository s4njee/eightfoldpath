import type { EffectMeta } from '../types.ts';

export const meta: EffectMeta = {
  id: 'pointer-lit-sprite',
  title: 'Pointer-lit sprite',
  epic: '9',
  tier: 'A',
  tags: ['web motif', 'avatar', 'pointer', 'lighting', 'normals', 'palette'],
  summary:
    'A pixel-art portrait in a round avatar frame, lit by a light that follows the cursor across the page: automatic normals from the alpha, a cool rim on the shadow side, a drop shadow on the backdrop, and light in bands snapped to the palette.',
  scorecard: {
    compute: false,
    mobile: 'untested',
    // A slow idle orbit; band edges move across a few texels at a time.
    flash: 'none',
    // The backdrop is an opaque disc with its own colour and the corners are transparent, so it
    // reads the same over any page.
    lightPage: 'yes',
    features: { required: [] },
    fallback: 'The portrait as a plain image in a CSS circle, or the poster.',
    depth: false,
    // No camera; the portrait never moves, only the light does.
    pixelStability: 'stable',
    useCases: [
      'An avatar or profile picture that turns toward the cursor',
      'A team or author card on an ordinary page, phones included',
      'Showing that a sprite has form without painting a normal map',
    ],
  },
};
