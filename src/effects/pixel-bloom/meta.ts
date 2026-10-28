import type { EffectMeta } from '../types.ts';

export const meta: EffectMeta = {
  id: 'pixel-bloom',
  title: 'Bloom for pixel scenes',
  epic: '5',
  tier: 'B',
  tags: ['lens', 'bloom', 'post', 'emissive'],
  summary:
    'Lanterns that glow without smearing the pixel art around them: the bloom threshold applied to each texel before anything is averaged, set above everything the sun and lamps light.',
  scorecard: {
    compute: false,
    mobile: 'untested',
    flash: 'none',
    lightPage: 'no',
    features: { required: [] },
    fallback: 'A still of the village at dusk with its two lanterns glowing.',
    depth: true,
    pixelStability: 'untested',
    useCases: [
      'The bloom of every diorama scene and hero (Epics 9 and 11)',
      'Any pixel-art canvas with a few emissive texels: lamps, windows, spell sparks',
    ],
  },
};
