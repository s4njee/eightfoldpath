import type { EffectMeta } from '../types.ts';

export const meta: EffectMeta = {
  id: 'dialogue-box',
  title: 'Dialogue box',
  epic: '9',
  // One render pass of a few dozen quads and a fullscreen light, plus the output pass. Provisional
  // until it is measured on an integrated GPU (13.2).
  tier: 'A',
  tags: ['web motif', 'ui', 'text', 'accessibility', 'nine-slice'],
  summary:
    'A game-style dialogue box that is a real component: HTML text a screen reader hears whole, typed out with punctuation pauses, in a pixel window, portrait and bouncing marker drawn on the GPU.',
  scorecard: {
    compute: false,
    mobile: 'untested',
    // The flash analyser measures none: the only changes are a five-texel marker and a halo that
    // breathes over five seconds.
    flash: 'none',
    lightPage: 'yes',
    features: { required: [] },
    fallback:
      'mountCssDialogue, exported with the effect: the same HTML, reveal and keys, with the frame as a CSS border-image.',
    depth: false,
    // Everything is drawn in whole texels at a whole-number scale and the backdrop drifts a whole
    // texel at a time.
    pixelStability: 'stable',
    useCases: [
      'Onboarding tips, tours and help text in a game-styled product',
      'Story pages, interactive fiction and character introductions',
      'A dialogue box over a pixel-art hero or scene',
    ],
  },
};
