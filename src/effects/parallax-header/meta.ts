import type { EffectMeta } from '../types.ts';

export const meta: EffectMeta = {
  id: 'parallax-header',
  title: 'Pixel parallax header',
  epic: '9',
  tier: 'A',
  tags: ['web motif', 'header', 'parallax', 'depth of field', 'light shafts'],
  summary:
    'Five flat pixel-art layers drifting at their own depths, the far ones softly out of focus, with light shafts from a low sun: the cheapest route to the look, sized for a page header.',
  scorecard: {
    compute: false,
    mobile: 'untested',
    // A slow drift and a static sun; the shafts change only as the mountains pass the sun.
    flash: 'none',
    // It is an opaque picture with its own sky, so it reads the same over any page.
    lightPage: 'yes',
    features: { required: [] },
    fallback: 'The poster, or the five layers as stacked CSS backgrounds with no blur or shafts.',
    depth: false,
    // Sharp sampling at a fractional scale: popping 0.09 to 0.12 against nearest's 0.24 to 0.26
    // under the default drift (experiments/parallax-header-stability.test.ts); not yet loupe-checked.
    pixelStability: 'stable',
    useCases: [
      'A page or section header with depth, on ordinary pages and phones',
      'A drop-in backdrop for hero copy where a lit diorama (story 9.1) costs too much',
    ],
  },
};
