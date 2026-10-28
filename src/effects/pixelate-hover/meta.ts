import type { EffectMeta } from '../types.ts';

export const meta: EffectMeta = {
  id: 'pixelate-hover',
  title: 'Pixelate hover',
  epic: '9',
  tier: 'A',
  tags: ['web motif', 'card', 'hover', 'palette', 'dither', 'mosaic'],
  summary:
    'A painted illustration that resolves between full detail and palette-mapped pixel art on hover, in whole block steps anchored to the picture, with ordered or blue-noise dither: a card image that turns into the game version of itself.',
  scorecard: {
    compute: false,
    mobile: 'untested',
    // Still until the pointer arrives; the transition is a handful of steps the visitor starts.
    flash: 'none',
    // An opaque picture, so it reads the same over any page.
    lightPage: 'yes',
    features: { required: [] },
    fallback: 'The illustration as a plain image, with the pixel-art version as a CSS hover swap.',
    depth: false,
    // The blocks and the dither are anchored to the picture, not the screen; nothing moves at rest.
    pixelStability: 'stable',
    useCases: [
      'Image cards in a grid: blog posts, projects, products',
      'A thumbnail that hints at a game or pixel-art version of a page',
      'A reveal: pixel art at rest, the painting on hover or focus',
    ],
  },
};
