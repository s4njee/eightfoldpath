import type { EffectMeta } from '../types.ts';

export const meta: EffectMeta = {
  id: 'bitmap-text',
  title: 'Bitmap text',
  epic: '3',
  // A building block with no tier of its own in plan.md. One instanced draw of a few hundred
  // quads; A is expected but not yet measured.
  tier: 'A',
  tags: ['building block', 'text', 'ui', 'font'],
  summary:
    'An original 5×7 pixel font built into an atlas at load, laid out in whole texels so it stays crisp at any integer scale, typed out in a nine-slice dialogue box.',
  scorecard: {
    compute: false,
    mobile: 'untested',
    // The flash analyser measures none over its window (small glyphs appear one at a time, the
    // "more" marker bobs rather than blinks). Called low because every seven seconds or so a
    // page turn clears the text at once, which falls outside that window.
    flash: 'low',
    lightPage: 'no',
    features: { required: [] },
    fallback: 'A still of the dialogue box with its text fully shown, or the same text as HTML.',
    depth: false,
    // Everything is placed in whole texels at a whole-number scale, so nothing resamples.
    pixelStability: 'stable',
    useCases: [
      'Dialogue boxes, signs and title cards in a pixel-art scene',
      'Damage numbers and labels drawn in the same pass as the sprites',
    ],
  },
};
