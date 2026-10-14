import forestUrl from '../../../assets/illustrations/forest.png?url';
import harbourUrl from '../../../assets/illustrations/harbour.png?url';
import townUrl from '../../../assets/illustrations/town.png?url';
import { loadPixels } from '../../gpu/assets.ts';
import {
  buildRamp,
  createBlueNoiseTexture,
  createPaletteLutTexture,
  createPaletteTexture,
  createRampTexture,
  EIGHTFOLD,
  hexToRgb8,
} from '../../gpu/palette/index.ts';
import { createHdrTail } from '../../gpu/post/index.ts';
import { createShader, withChunks } from '../../gpu/shader.ts';
import { createTextureFromData } from '../../gpu/texture.ts';
import { createUniformBuffer, defineUniformStruct } from '../../gpu/uniforms.ts';
import { defaultInspect, defineEffect } from '../types.ts';
import { meta } from './meta.ts';
import shader from './palette-mapping.wgsl';

const Params = defineUniformStruct('Params', {
  cover: 'vec4f',
  light: 'vec3f',
  lod: 'f32',
  canvas: 'vec2f',
  source_size: 'vec2f',
  block: 'f32',
  input: 'f32',
  shading: 'f32',
  dither: 'f32',
  strength: 'f32',
  mapping: 'f32',
  view: 'f32',
  error_gain: 'f32',
});

const PICTURES: Readonly<Record<string, string>> = {
  town: townUrl,
  forest: forestUrl,
  harbour: harbourUrl,
};
const SOURCES = ['town', 'forest', 'harbour', 'lit scene'] as const;
const DITHERS = ['none', 'bayer', 'blue noise'] as const;
const SHADINGS = ['nearest colour', 'palette ramp'] as const;

/** The four spheres of the lit scene: moss, brick, lake and sand, as palette colours. */
const RAMP_BASES = ['439638', 'da3a37', '2b70b7', 'bf9d6c'].map(hexToRgb8);

const VIEWS: Readonly<Record<string, number>> = { error: 1, threshold: 2, lut: 3 };

export const effect = defineEffect({
  meta,
  params: {
    source: { type: 'select', default: 'town', options: SOURCES },
    pixelSize: { type: 'number', default: 3, min: 1, max: 8, step: 1, label: 'pixel size' },
    dither: { type: 'select', default: 'bayer', options: DITHERS },
    ditherStrength: {
      type: 'number',
      default: 0.12,
      min: 0,
      max: 0.5,
      step: 0.01,
      label: 'dither strength',
    },
    shading: {
      type: 'select',
      default: 'palette ramp',
      options: SHADINGS,
      label: 'lit scene shading',
    },
    lightSpeed: { type: 'number', default: 0.5, min: -2, max: 2, step: 0.01, label: 'light speed' },
  },
  presets: {
    'town, ordered dither': { source: 'town', dither: 'bayer', pixelSize: 3 },
    'forest, blue noise': { source: 'forest', dither: 'blue noise', pixelSize: 3 },
    'harbour, no dither': { source: 'harbour', dither: 'none', pixelSize: 2 },
    'lit scene, palette ramps': { source: 'lit scene', shading: 'palette ramp', pixelSize: 4 },
    'lit scene, nearest colour': {
      source: 'lit scene',
      shading: 'nearest colour',
      dither: 'blue noise',
      pixelSize: 4,
    },
  },
  inspect: {
    views: ['error', 'threshold', 'lut'],
    // `lut` off swaps the table for the exact 48-colour search, to compare the two.
    stages: ['palette', 'lut', 'dither', 'pixelation'],
  },

  async create({ device, format, hdr, params, profiler, inspect = defaultInspect() }) {
    const tail = createHdrTail(device, { format, hdr, label: 'palette-mapping' });
    const lut = createPaletteLutTexture(device, EIGHTFOLD);
    const palette = createPaletteTexture(device, EIGHTFOLD);
    const ramps = RAMP_BASES.map((base) => buildRamp(EIGHTFOLD, base));
    const rampTexture = createRampTexture(
      device,
      EIGHTFOLD,
      ramps,
      Math.max(...ramps.map((ramp) => ramp.length)),
    );
    const blueNoise = createBlueNoiseTexture(device);
    const sampler = device.createSampler({
      label: 'palette-mapping picture',
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
    });
    const uniforms = createUniformBuffer(device, Params, 'palette-mapping params');

    // Each illustration is 1376 × 768 and about 1.7 MB, so only the one on show is loaded; the
    // others load when picked, and the previous picture stays up until they arrive.
    interface Picture {
      texture: GPUTexture;
      width: number;
      height: number;
    }
    const pictures = new Map<string, Promise<Picture>>();
    let destroyed = false;
    const loadPicture = (name: string): Promise<Picture> => {
      let promise = pictures.get(name);
      if (!promise) {
        promise = loadPixels(PICTURES[name]!).then((pixels) => ({
          texture: createTextureFromData(device, {
            label: `palette-mapping ${name}`,
            width: pixels.width,
            height: pixels.height,
            format: 'rgba8unorm-srgb',
            data: pixels.data,
            mipmaps: true,
          }),
          width: pixels.width,
          height: pixels.height,
        }));
        pictures.set(name, promise);
        promise
          .then((picture) => {
            if (destroyed) picture.texture.destroy();
            else if (params.source === name) show(picture);
          })
          .catch((error: unknown) => console.error(error));
      }
      return promise;
    };

    const module = createShader(device, withChunks(shader, { 'params.wgsl': Params.wgsl }));
    const fragment = GPUShaderStage.FRAGMENT;
    const sharedLayout = device.createBindGroupLayout({
      label: 'palette-mapping shared',
      entries: [
        { binding: 0, visibility: fragment, buffer: {} },
        { binding: 1, visibility: fragment, texture: { viewDimension: '3d' } },
        { binding: 2, visibility: fragment, texture: {} },
        { binding: 3, visibility: fragment, texture: {} },
        { binding: 4, visibility: fragment, texture: {} },
        { binding: 5, visibility: fragment, texture: {} },
        { binding: 6, visibility: fragment, sampler: {} },
      ],
    });
    const sourceLayout = device.createBindGroupLayout({
      label: 'palette-mapping source',
      entries: [
        { binding: 0, visibility: fragment, texture: { sampleType: 'unfilterable-float' } },
      ],
    });
    const pipeline = (
      entryPoint: string,
      layouts: GPUBindGroupLayout[],
      target: GPUTextureFormat,
    ) =>
      device.createRenderPipeline({
        label: `palette-mapping ${entryPoint}`,
        layout: device.createPipelineLayout({ bindGroupLayouts: layouts }),
        vertex: { module, entryPoint: 'fullscreen_vs' },
        fragment: { module, entryPoint, targets: [{ format: target }] },
      });
    const SOURCE_FORMAT: GPUTextureFormat = 'rgba16float';
    const sourcePipeline = pipeline('fs_source', [sharedLayout], SOURCE_FORMAT);
    const mapPipeline = pipeline('fs_map', [sharedLayout, sourceLayout], tail.scene.format);

    let shared: GPUBindGroup;
    let current: Picture;
    function show(picture: Picture) {
      current = picture;
      shared = device.createBindGroup({
        label: 'palette-mapping shared',
        layout: sharedLayout,
        entries: [
          { binding: 0, resource: { buffer: uniforms.buffer } },
          { binding: 1, resource: lut.createView({ dimension: '3d' }) },
          { binding: 2, resource: palette.createView() },
          { binding: 3, resource: rampTexture.createView() },
          { binding: 4, resource: blueNoise.createView() },
          { binding: 5, resource: picture.texture.createView() },
          { binding: 6, resource: sampler },
        ],
      });
    }
    show(await loadPicture(params.source in PICTURES ? params.source : 'town'));

    let source: GPUTexture | undefined;
    let sourceGroup: GPUBindGroup | undefined;
    let width = 1;
    let height = 1;
    let phase = 0.6;

    /** The low-resolution target the input is drawn into, one texel per block of pixels. */
    function sourceFor(block: number): GPUTexture {
      const w = Math.ceil(width / block);
      const h = Math.ceil(height / block);
      if (!source || source.width !== w || source.height !== h) {
        source?.destroy();
        source = device.createTexture({
          label: 'palette-mapping source',
          size: [w, h],
          format: SOURCE_FORMAT,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        sourceGroup = device.createBindGroup({
          label: 'palette-mapping source',
          layout: sourceLayout,
          entries: [{ binding: 0, resource: source.createView() }],
        });
      }
      return source;
    }

    return {
      resize(w, h) {
        tail.resize(w, h);
        width = w;
        height = h;
      },
      frame(time, encoder, target) {
        phase += time.delta * params.lightSpeed;
        if (params.source in PICTURES) void loadPicture(params.source);

        const block = inspect.off.has('pixelation') ? 1 : Math.max(1, Math.round(params.pixelSize));
        const lowRes = sourceFor(block);

        // Cover the frame with the picture, cropping the longer side, and pick the mip that has
        // about one texel per block so the minified picture does not alias.
        const pictureAspect = current.width / current.height;
        const frameAspect = width / height;
        const cover: [number, number, number, number] =
          frameAspect > pictureAspect
            ? [0, (1 - pictureAspect / frameAspect) / 2, 1, pictureAspect / frameAspect]
            : [(1 - frameAspect / pictureAspect) / 2, 0, frameAspect / pictureAspect, 1];
        const texelsPerBlock = (current.width * cover[2]!) / lowRes.width;

        uniforms.set({
          cover,
          light: [
            0.75 * Math.cos(phase),
            0.22 + 0.1 * Math.sin(phase * 0.7),
            0.35 + 0.2 * Math.sin(phase),
          ],
          lod: Math.log2(Math.max(1, texelsPerBlock)),
          canvas: [width, height],
          source_size: [lowRes.width, lowRes.height],
          block,
          input: params.source === 'lit scene' ? 1 : 0,
          shading: params.shading === 'palette ramp' ? 1 : 0,
          dither: inspect.off.has('dither')
            ? 0
            : DITHERS.indexOf(params.dither as (typeof DITHERS)[number]),
          strength: inspect.off.has('dither') ? 0 : params.ditherStrength,
          mapping: inspect.off.has('palette') ? 0 : inspect.off.has('lut') ? 2 : 1,
          view: VIEWS[inspect.view] ?? 0,
          error_gain: 8,
        });
        uniforms.upload();

        const sourcePass = encoder.beginRenderPass({
          label: 'palette-mapping source',
          colorAttachments: [
            {
              view: lowRes.createView(),
              loadOp: 'clear',
              storeOp: 'store',
              clearValue: [0, 0, 0, 1],
            },
          ],
          timestampWrites: profiler.pass('source'),
        });
        sourcePass.setPipeline(sourcePipeline);
        sourcePass.setBindGroup(0, shared);
        sourcePass.draw(3);
        sourcePass.end();

        const mapPass = encoder.beginRenderPass({
          label: 'palette-mapping map',
          colorAttachments: [
            { view: tail.scene.view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
          ],
          timestampWrites: profiler.pass('map'),
        });
        mapPass.setPipeline(mapPipeline);
        mapPass.setBindGroup(0, shared);
        mapPass.setBindGroup(1, sourceGroup!);
        mapPass.draw(3);
        mapPass.end();

        // No bloom, no tonemap and no output dither: the palette colours reach the canvas exactly.
        tail.encode(
          encoder,
          target,
          time,
          { exposure: 1, bloom: 0, bloomThreshold: 1, bloomRadius: 0.5 },
          profiler,
          { bloom: false, output: { tonemap: 'none', dither: 0, exposure: 1 } },
        );
      },
      destroy() {
        destroyed = true;
        for (const promise of pictures.values()) {
          void promise.then((picture) => picture.texture.destroy()).catch(() => {});
        }
        source?.destroy();
        lut.destroy();
        palette.destroy();
        rampTexture.destroy();
        blueNoise.destroy();
        uniforms.destroy();
        tail.destroy();
      },
    };
  },
});
