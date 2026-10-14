import type { EffectMeta } from '../types.ts';

export const meta: EffectMeta = {
  id: 'low-res-path',
  title: 'Low-resolution path',
  epic: '3',
  tier: 'B',
  tags: ['building block', 'pixel art', 'upscale', 'camera', 'low resolution'],
  summary:
    'The diorama drawn at a fixed virtual resolution of one texel per pixel, with the camera snapped to whole virtual pixels and the remainder put back as an offset while scaling up, so it scrolls smoothly without a texel ever changing shape.',
  scorecard: {
    compute: false,
    mobile: 'untested',
    // tests/flash.test.ts measures one small cell changing once (the walker passing): low.
    flash: 'low',
    lightPage: 'no',
    features: { required: [] },
    fallback: 'A still of the scene, which looks the same as the live one would at rest.',
    depth: true,
    // Measured by experiments/lowres-path-study.test.ts: with the default orthographic camera no
    // virtual pixel changes shape while it pans. Orbiting and the perspective preset do swim.
    pixelStability: 'stable',
    // The sharp upscale blends one pixel at each moving edge; nearest upscaling gives 1.0.
    paletteAdherence: 0.63,
    useCases: [
      'A cheaper, chunkier take on the diorama: everything on one pixel grid',
      'Hero sections that want the retro look with smooth scrolling',
    ],
  },
};
