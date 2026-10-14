/*
 * Pixel-art images as GPU textures (story 1.5).
 *
 *   const pixels = await loadPixels(url);                 // RGBA8, straight alpha, sRGB-encoded
 *   const { texture, layers } = packTextureArray(device, [ground, sprite]);
 *   const sampler = createPixelSampler(device);
 *
 * Images are decoded to raw pixels rather than uploaded with copyExternalImageToTexture, because
 * pixel art is small and later stories read the pixels on the CPU (palette checks, normals from
 * alpha, atlas packing). The decoder is swappable: the browser uses fetch + createImageBitmap, and
 * the headless tests install one that reads PNGs from disk (tests/setup.ts), so an effect that
 * loads art runs the same in both.
 */

export interface Pixels {
  readonly width: number;
  readonly height: number;
  /** RGBA8, row-major, straight (not premultiplied) alpha, sRGB-encoded colour. */
  readonly data: Uint8Array;
}

export type ImageDecoder = (url: string) => Promise<Pixels>;

async function decodeInBrowser(url: string): Promise<Pixels> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}: HTTP ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob(), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('No 2D context to decode images with');
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  // The 2D canvas stores premultiplied colour, which would round partial alpha. The cleaned
  // assets have alpha of exactly 0 or 255 (scripts/check-assets.mjs), so nothing is lost.
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return { width: image.width, height: image.height, data: new Uint8Array(image.data.buffer) };
}

let decoder: ImageDecoder = decodeInBrowser;

/** Replace the image decoder. The headless tests use this; application code should not. */
export function setImageDecoder(next: ImageDecoder): void {
  decoder = next;
}

export function loadPixels(url: string): Promise<Pixels> {
  return decoder(url);
}

/** Nearest-neighbour sampling, so texels stay square. Story 3.1 compares the alternatives. */
export function createPixelSampler(
  device: GPUDevice,
  addressMode: GPUAddressMode = 'clamp-to-edge',
): GPUSampler {
  return device.createSampler({
    label: 'pixel sampler',
    magFilter: 'nearest',
    minFilter: 'nearest',
    addressModeU: addressMode,
    addressModeV: addressMode,
  });
}

export interface ArrayLayer {
  readonly layer: number;
  readonly width: number;
  readonly height: number;
  /** The image's share of the layer, for scaling 0..1 UVs onto it. */
  readonly uvScale: readonly [number, number];
}

export interface TextureArray {
  readonly texture: GPUTexture;
  /** A `2d-array` view, which is what the shaders bind even for a single layer. */
  readonly view: GPUTextureView;
  readonly layers: readonly ArrayLayer[];
}

/**
 * Packs images into one `2d-array` texture, one image per layer at the layer's origin. Every
 * layer is the size of the largest image, so small sprites waste space; that is fine for the
 * test set (all of it fits in a few hundred kilobytes) and keeps lookups a layer index plus a
 * UV scale. A real atlas with several images per layer is a later concern.
 */
export function packTextureArray(
  device: GPUDevice,
  images: readonly Pixels[],
  label = 'pixel art',
): TextureArray {
  if (images.length === 0) throw new Error('packTextureArray needs at least one image');
  const width = Math.max(...images.map((image) => image.width));
  const height = Math.max(...images.map((image) => image.height));
  const texture = device.createTexture({
    label,
    size: [width, height, images.length],
    format: 'rgba8unorm-srgb',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const layers = images.map((image, layer) => {
    device.queue.writeTexture(
      { texture, origin: [0, 0, layer] },
      image.data as Uint8Array<ArrayBuffer>,
      { bytesPerRow: image.width * 4, rowsPerImage: image.height },
      [image.width, image.height, 1],
    );
    return {
      layer,
      width: image.width,
      height: image.height,
      uvScale: [image.width / width, image.height / height] as const,
    };
  });
  return { texture, view: texture.createView({ dimension: '2d-array' }), layers };
}
