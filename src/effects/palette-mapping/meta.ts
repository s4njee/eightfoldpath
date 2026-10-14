import type { EffectMeta } from '../types.ts';

export const meta: EffectMeta = {
  id: 'palette-mapping',
  title: 'Palette mapping',
  epic: '3',
  // A building block with no tier of its own in plan.md; C until a cost study says otherwise,
  // because the demo runs a full-resolution pass plus a source pass.
  tier: 'C',
  tags: ['building block', 'palette', 'dither', 'oklab', 'post'],
  summary:
    'Any picture forced into the 48-colour project palette: nearest colour in OKLab through a 32³ lookup table, with Bayer or blue-noise dither, and lighting shaded through palette ramps.',
  scorecard: {
    compute: false,
    mobile: 'untested',
    // Measured by tests/flash.test.ts: the default (a still illustration) does not change.
    flash: 'none',
    lightPage: 'no',
    features: { required: [] },
    fallback: 'A still of the mapped illustration.',
    depth: false,
    // No camera. The dither is anchored to the pixel grid, so a still picture holds still; the
    // lit scene's dither changes only where the light does.
    pixelStability: 'stable',
    useCases: [
      'Holding a lit scene, a painted backdrop or a photo to the project palette',
      'The palette lookup, dither and ramps that the low-resolution path and sprite lighting reuse',
    ],
  },
};
