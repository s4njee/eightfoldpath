import type { EffectMeta } from '../types.ts';

export const meta: EffectMeta = {
  id: 'menu-windows',
  title: 'Menu windows',
  epic: '9',
  // Per frame: one fullscreen pass, a few dozen quads and the output pass; the diorama behind is
  // a still, redrawn only on resize. Provisional until it is measured on an integrated GPU (13.2).
  tier: 'A',
  tags: ['web motif', 'ui', 'menu', 'blur', 'accessibility', 'nine-slice'],
  summary:
    'Game-style menu windows of real buttons, framed in pixel art over a blurred and tinted copy of the diorama behind them, with a pointing hand that follows the keyboard.',
  scorecard: {
    compute: false,
    mobile: 'untested',
    // A still backdrop; the only motion is the hand's one-texel nudge.
    flash: 'none',
    lightPage: 'yes',
    features: { required: [] },
    fallback:
      'mountCssMenu, exported with the effect: the same buttons and keys, with the border as a CSS border-image and the glass as backdrop-filter.',
    depth: true,
    pixelStability: 'stable',
    useCases: [
      'Settings, pause and command menus in a game-styled site',
      'A navigation panel or account menu over a pixel-art hero',
      'Any panel of text over a busy scene that must stay legible',
    ],
  },
};
