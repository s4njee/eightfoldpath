import { describe, expect, it } from 'vitest';
import traveller from '../assets/sprites/traveller.png?url';
import cobblestone from '../assets/tiles/cobblestone.png?url';
import { loadPixels, packTextureArray } from '../src/gpu/assets.ts';
import { expectValid, getTestDevice } from './gpu.ts';

describe('pixel-art assets', () => {
  it('decodes a cleaned sprite with binary alpha', async () => {
    const pixels = await loadPixels(traveller);
    expect([pixels.width, pixels.height]).toEqual([35, 68]);
    const alphas = new Set<number>();
    for (let p = 3; p < pixels.data.length; p += 4) alphas.add(pixels.data[p]!);
    expect([...alphas].sort((a, b) => a - b)).toEqual([0, 255]);
  });

  it('packs images of different sizes into one texture array', async () => {
    const device = await getTestDevice();
    const images = [await loadPixels(cobblestone), await loadPixels(traveller)];
    await expectValid(device, async () => {
      const packed = packTextureArray(device, images);
      expect([packed.texture.width, packed.texture.height]).toEqual([99, 99]);
      expect(packed.texture.depthOrArrayLayers).toBe(2);
      expect(packed.layers[1]!.uvScale[0]).toBeCloseTo(35 / 99);
      expect(packed.layers[1]!.uvScale[1]).toBeCloseTo(68 / 99);
      packed.texture.destroy();
    });
  });
});
