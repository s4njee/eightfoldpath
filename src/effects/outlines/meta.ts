import type { EffectMeta } from '../types.ts';

export const meta: EffectMeta = {
  id: 'outlines',
  title: 'Outlines',
  epic: '3',
  tier: 'B',
  tags: ['building block', 'post', 'outline', 'selection', 'g-buffer'],
  summary:
    'One-pixel lines where depth, surface angle or object changes, found in a post pass over a small G-buffer, and a selection outline that shows through whatever hides the selected sprite.',
  scorecard: {
    compute: false,
    mobile: 'untested',
    // Lines are static; the only change over time is the selection outline moving from one
    // character to the next every 2.5 seconds, a thin line over a small area.
    flash: 'low',
    // It draws a whole opaque diorama; outlines over page content are not what it is for.
    lightPage: 'no',
    features: { required: [] },
    fallback: 'A still of the diorama with its outlines and one character selected.',
    depth: true,
    // Lines follow the pixel grid of whatever is rendered; with the camera swaying they crawl
    // exactly as much as the cut-out edges under them. Not checked with the loupe.
    pixelStability: 'untested',
    useCases: [
      'Hover and selection highlights for sprites in an interactive diorama',
      'Ink lines that separate terrain steps and overlapping props at a distance',
      'A reusable post pass for any effect that can write normals and object IDs',
    ],
  },
};
