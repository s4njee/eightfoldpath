import { describe, expect, it } from 'vitest';
import { bleedColour, packMippedTextureArray } from '../src/gpu/pixel/mips.ts';
import { expectValid, getTestDevice } from './gpu.ts';

// Story 3.1's mipmapped texture array. The sampling comparison itself is measured by
// experiments/texel-sampling-study.test.ts; these check the pieces it relies on.

/** A 4 × 2 image: two opaque texels, red and blue, in a row of transparent black. */
const image = {
  width: 4,
  height: 2,
  data: new Uint8Array([
    ...[255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255],
    ...[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ]),
};

describe('bleedColour', () => {
  it('fills transparent texels with their opaque neighbours’ colour and keeps alpha', () => {
    const out = bleedColour(image);
    const texel = (x: number, y: number) => [
      ...out.data.subarray((y * 4 + x) * 4, (y * 4 + x) * 4 + 4),
    ];
    expect(texel(0, 0)).toEqual([255, 0, 0, 255]);
    // Next to red only.
    expect(texel(1, 0)).toEqual([255, 0, 0, 0]);
    // Next to blue only.
    expect(texel(2, 0)).toEqual([0, 0, 255, 0]);
    // The row below: (1, 1) touches red diagonally and (2, 1) blue; the texels between them were
    // still empty when this pass began, so neither picks up the other colour.
    expect(texel(1, 1)).toEqual([255, 0, 0, 0]);
    expect(texel(2, 1)).toEqual([0, 0, 255, 0]);
    for (let i = 3; i < out.data.length; i += 4) expect(out.data[i]).toBe(image.data[i]);
  });

  it('pads to a layer size and colours the padding too', () => {
    const out = bleedColour(image, 8, 4, 1);
    expect(out.width).toBe(8);
    // Beyond one pass of growth: the mean opaque colour, half red and half blue.
    expect([...out.data.subarray((3 * 8 + 7) * 4, (3 * 8 + 7) * 4 + 4)]).toEqual([128, 0, 128, 0]);
  });
});

describe('packMippedTextureArray', () => {
  it('builds a full chain over every layer, in the layout packTextureArray uses', async () => {
    const device = await getTestDevice();
    const art = await expectValid(device, () =>
      packMippedTextureArray(device, [
        image,
        { width: 2, height: 3, data: new Uint8Array(24).fill(255) },
      ]),
    );
    expect(art.texture.mipLevelCount).toBe(3);
    expect(art.mipLevelCount).toBe(3);
    expect(art.texture.depthOrArrayLayers).toBe(2);
    expect(art.layers[1]).toMatchObject({ layer: 1, width: 2, height: 3, uvScale: [0.5, 1] });
    art.texture.destroy();
  });
});
