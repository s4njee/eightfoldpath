/*
 * Pixel art as a mipmapped texture array, for story 3.1's "with and without mipmaps" comparison.
 *
 *   const art = packMippedTextureArray(device, [ground, traveller]);
 *   ... bind art.view with a sampler whose mipmapFilter is 'linear' (texel-mips.wgsl reads it).
 *
 * `packTextureArray` (src/gpu/assets.ts) uploads level 0 only, which is all the sprite batcher
 * reads. Mipmapping pixel art has one trap: the cleaned art stores transparent texels as
 * (0, 0, 0, 0), and a linear downsample of straight-alpha colour averages that black into every
 * edge, so a sprite or a tile seen from far away grows a dark rim. `bleedColour` copies the colour
 * of the nearest opaque texels into the transparent ones (alpha stays 0) before the chain is
 * built, which is the usual fix and costs nothing at draw time.
 */
import type { ArrayLayer, Pixels, TextureArray } from '../assets.ts';
import { generateMipmaps, mipLevelCount } from '../mipmap.ts';

/**
 * A copy of `image` padded to `width` × `height` whose transparent texels carry the colour of
 * their opaque neighbours, grown outwards one texel per pass; whatever is still unreached after
 * `passes` gets the image's mean opaque colour. Alpha is untouched.
 */
export function bleedColour(image: Pixels, width = image.width, height = image.height, passes = 8) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < image.height; y++) {
    data.set(image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4), y * width * 4);
  }
  // Which texels have a colour worth spreading: the opaque ones to start with.
  let filled = new Uint8Array(width * height);
  const mean = [0, 0, 0];
  let opaque = 0;
  for (let i = 0; i < width * height; i++) {
    if (data[i * 4 + 3]! > 0) {
      filled[i] = 1;
      for (let c = 0; c < 3; c++) mean[c]! += data[i * 4 + c]!;
      opaque++;
    }
  }
  for (let pass = 0; pass < passes; pass++) {
    const next = filled.slice();
    let grew = false;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (filled[i]) continue;
        const sum = [0, 0, 0];
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const j = ny * width + nx;
            if (!filled[j]) continue;
            for (let c = 0; c < 3; c++) sum[c]! += data[j * 4 + c]!;
            n++;
          }
        }
        if (n === 0) continue;
        for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(sum[c]! / n);
        next[i] = 1;
        grew = true;
      }
    }
    filled = next;
    if (!grew) break;
  }
  for (let i = 0; i < width * height; i++) {
    if (filled[i] || opaque === 0) continue;
    for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(mean[c]! / opaque);
  }
  return { width, height, data };
}

export interface MippedTextureArray extends TextureArray {
  readonly mipLevelCount: number;
}

/**
 * `packTextureArray` with a full mip chain: the same layer layout (one image per layer at its
 * origin, every layer the size of the largest image), so a batcher's layer indices and texel
 * coordinates address it unchanged.
 */
export function packMippedTextureArray(
  device: GPUDevice,
  images: readonly Pixels[],
  label = 'pixel art (mipmapped)',
): MippedTextureArray {
  if (images.length === 0) throw new Error('packMippedTextureArray needs at least one image');
  const width = Math.max(...images.map((image) => image.width));
  const height = Math.max(...images.map((image) => image.height));
  const levels = mipLevelCount(width, height);
  const texture = device.createTexture({
    label,
    size: [width, height, images.length],
    format: 'rgba8unorm-srgb',
    mipLevelCount: levels,
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const layers: ArrayLayer[] = images.map((image, layer) => {
    // Padded to the layer size before bleeding, so the padding a small sprite sits in is not
    // black either: at the coarse levels it is averaged into the image's own edge.
    const padded = bleedColour(image, width, height);
    device.queue.writeTexture(
      { texture, origin: [0, 0, layer] },
      padded.data as Uint8Array<ArrayBuffer>,
      { bytesPerRow: width * 4, rowsPerImage: height },
      [width, height, 1],
    );
    return {
      layer,
      width: image.width,
      height: image.height,
      uvScale: [image.width / width, image.height / height] as const,
    };
  });
  generateMipmaps(device, texture);
  return {
    texture,
    view: texture.createView({ dimension: '2d-array' }),
    layers,
    mipLevelCount: levels,
  };
}

/** Trilinear: what texel-mips.wgsl expects (it picks integer levels itself where it needs to). */
export function createMipSampler(device: GPUDevice): GPUSampler {
  return device.createSampler({
    label: 'pixel art mipmapped',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
  });
}
