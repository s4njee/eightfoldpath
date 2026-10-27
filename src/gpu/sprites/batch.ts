/*
 * The sprite batcher (story 3.2): pixel-art sprites in a 3D scene, all in one instanced draw.
 *
 *   const batch = createSpriteBatch(device, { sheets: [ground, traveller], colorFormat });
 *   const view = batch.createView();
 *   batch.setSprites([{ sheet: 0, facing: 'ground', ... }, { sheet: 1, position: [0, 0, 0] }]);
 *   ...each frame:
 *   view.update(camera, { time: time.time, sampling: 'sharp' });
 *   batch.draw(pass, view, { sampleCount: 4, coverage: true });
 *
 * Sprites stand on their feet and turn to face the camera about the vertical axis (`upright`),
 * face it fully (`camera`), or lie flat (`ground`, for tiles). Animation is a strip of frames left
 * to right in the sheet, played at the sprite's own rate whatever the scene's frame rate. The
 * colour each fragment ends up with is the effect's `shade` chunk, so lighting, outlines and
 * palette work plug in without forking the batcher; a shade chunk can bring its own bindings in
 * group 2 (`shadeLayout`, `draw({ shadeGroup })`).
 */
import { packTextureArray, type ArrayLayer, type Pixels } from '../assets.ts';
import { createShader, withChunks } from '../shader.ts';
import shader from './batch.wgsl';
import type { CameraState } from './camera.ts';

/** World units per texel: one tile is 16 texels (plan.md, "Pixel scale"). */
export const TEXEL = 1 / 16;

export const SAMPLING_MODES = ['nearest', 'bilinear', 'sharp'] as const;
export type SamplingMode = (typeof SAMPLING_MODES)[number];

export type Facing = 'upright' | 'camera' | 'ground';
const FACING_CODE: Readonly<Record<Facing, number>> = { upright: 0, camera: 1, ground: 2 };

export interface Sprite {
  /** Feet for `upright` and `camera` sprites, centre for `ground` ones. */
  position: readonly [number, number, number];
  /** Index into `options.sheets`. */
  sheet: number;
  /** The first frame's rectangle in texels: x, y, width, height. Default: the whole image. */
  region?: readonly [number, number, number, number];
  /** World size. Default: the region at the shared texel density, times `scale`. */
  size?: readonly [number, number];
  scale?: number;
  facing?: Facing;
  /** Frames laid out left to right from `region`. Default 1. */
  frames?: number;
  fps?: number;
  /** Seconds at which frame `frame` is shown; the strip loops from there. */
  start?: number;
  frame?: number;
  flipX?: boolean;
  /** Linear multiplier. Default white. */
  tint?: readonly [number, number, number];
  /** Hit flash toward white, 0..1. */
  flash?: number;
}

export interface ViewSettings {
  /** Seconds, for animation. */
  time: number;
  sampling?: SamplingMode;
  /**
   * Fragments with less alpha than this are discarded. 0.5 for a hard cut-out; near 0 with
   * alpha-to-coverage, which turns the remaining alpha into coverage instead.
   */
  alphaCut?: number;
}

export interface SpriteView {
  readonly bindGroup: GPUBindGroup;
  update(camera: CameraState, settings: ViewSettings): void;
  destroy(): void;
}

export interface SpriteBatchOptions {
  sheets: readonly Pixels[];
  /** Normal maps, one per sheet and the same size, for lit sprites (story 3.3). */
  normals?: readonly Pixels[];
  /** WGSL defining `fn sprite_shade(f: SpriteFragment) -> vec3f`. Default: the art, unlit. */
  shade?: string;
  /** Bindings the shade chunk declares in group 2. */
  shadeLayout?: GPUBindGroupLayout;
  /** Format of the colour target, usually the HDR tail's `rgba16float` scene. */
  colorFormat: GPUTextureFormat;
  /** Default `depth24plus`. */
  depthFormat?: GPUTextureFormat;
  maxSprites?: number;
  label?: string;
}

export interface DrawOptions {
  /** Must match the pass's attachments. Default 1. */
  sampleCount?: number;
  /** Alpha-to-coverage, for antialiased cut-outs. Needs `sampleCount` above 1. */
  coverage?: boolean;
  /** Group 2, when the shade chunk has bindings. */
  shadeGroup?: GPUBindGroup;
}

export interface SpriteBatch {
  /** Where each sheet landed in the texture array. */
  readonly layers: readonly ArrayLayer[];
  readonly count: number;
  createView(label?: string): SpriteView;
  setSprites(sprites: readonly Sprite[]): void;
  draw(pass: GPURenderPassEncoder, view: SpriteView, options?: DrawOptions): void;
  /** Depth only, for a shadow map: the same quads and cut-out from another view. */
  drawDepth(
    pass: GPURenderPassEncoder,
    view: SpriteView,
    options: { depthFormat: GPUTextureFormat; sampleCount?: number },
  ): void;
  destroy(): void;
}

const UNLIT = 'fn sprite_shade(f: SpriteFragment) -> vec3f {\n  return f.color.rgb;\n}\n';
const SPRITE_FLOATS = 20;
const VIEW_FLOATS = 32;

const flatNormal: Pixels = { width: 1, height: 1, data: new Uint8Array([128, 128, 255, 255]) };

export function createSpriteBatch(device: GPUDevice, options: SpriteBatchOptions): SpriteBatch {
  const label = options.label ?? 'sprites';
  const depthFormat = options.depthFormat ?? 'depth24plus';
  const maxSprites = options.maxSprites ?? 256;
  const art = packTextureArray(device, options.sheets, `${label} art`);
  if (options.normals && options.normals.length !== options.sheets.length) {
    throw new Error('createSpriteBatch: give one normal map per sheet');
  }
  // Normal maps are data, not colour: a linear format, so textureLoad returns the bytes as written.
  const normals = packTextureArray(
    device,
    options.normals ?? [flatNormal],
    `${label} normals`,
    'rgba8unorm',
  );

  const sprites = device.createBuffer({
    label: `${label} instances`,
    size: maxSprites * SPRITE_FLOATS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const linear = device.createSampler({
    label: `${label} linear`,
    magFilter: 'linear',
    minFilter: 'linear',
  });

  const viewLayout = device.createBindGroupLayout({
    label: `${label} view`,
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
    ],
  });
  const resourceLayout = device.createBindGroupLayout({
    label: `${label} resources`,
    entries: [
      // Fragment too: a shade chunk may read its sprite's entry (src/gpu/diorama/shade.wgsl).
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'read-only-storage' },
      },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: '2d-array' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: '2d-array' } },
    ],
  });
  const resources = device.createBindGroup({
    label: `${label} resources`,
    layout: resourceLayout,
    entries: [
      { binding: 0, resource: { buffer: sprites } },
      { binding: 1, resource: art.view },
      { binding: 2, resource: linear },
      { binding: 3, resource: normals.view },
    ],
  });
  const layout = device.createPipelineLayout({
    label,
    bindGroupLayouts: options.shadeLayout
      ? [viewLayout, resourceLayout, options.shadeLayout]
      : [viewLayout, resourceLayout],
  });
  const module = createShader(
    device,
    withChunks(shader, { 'sprite-shade.wgsl': options.shade ?? UNLIT }),
  );

  const colorPipelines = new Map<string, GPURenderPipeline>();
  function colorPipeline(sampleCount: number, coverage: boolean): GPURenderPipeline {
    const key = `${sampleCount}/${coverage}`;
    let pipeline = colorPipelines.get(key);
    if (!pipeline) {
      pipeline = device.createRenderPipeline({
        label: `${label} ${key}`,
        layout,
        vertex: { module, entryPoint: 'vs_sprite' },
        fragment: { module, entryPoint: 'fs_sprite', targets: [{ format: options.colorFormat }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'less' },
        multisample: { count: sampleCount, alphaToCoverageEnabled: coverage && sampleCount > 1 },
      });
      colorPipelines.set(key, pipeline);
    }
    return pipeline;
  }

  const depthPipelines = new Map<string, GPURenderPipeline>();
  function depthPipeline(format: GPUTextureFormat, sampleCount: number): GPURenderPipeline {
    const key = `${format}/${sampleCount}`;
    let pipeline = depthPipelines.get(key);
    if (!pipeline) {
      pipeline = device.createRenderPipeline({
        label: `${label} depth ${key}`,
        layout: device.createPipelineLayout({ bindGroupLayouts: [viewLayout, resourceLayout] }),
        vertex: { module, entryPoint: 'vs_sprite' },
        fragment: { module, entryPoint: 'fs_depth', targets: [] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format, depthWriteEnabled: true, depthCompare: 'less' },
        multisample: { count: sampleCount },
      });
      depthPipelines.set(key, pipeline);
    }
    return pipeline;
  }

  const instanceData = new Float32Array(maxSprites * SPRITE_FLOATS);
  let count = 0;

  return {
    layers: art.layers,
    get count() {
      return count;
    },
    createView(viewLabel = `${label} view`) {
      const buffer = device.createBuffer({
        label: viewLabel,
        size: VIEW_FLOATS * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const data = new Float32Array(VIEW_FLOATS);
      return {
        bindGroup: device.createBindGroup({
          label: viewLabel,
          layout: viewLayout,
          entries: [{ binding: 0, resource: { buffer } }],
        }),
        update(camera, settings) {
          data.set(camera.viewProj, 0);
          data.set([...camera.eye, 1, ...camera.right, 0, ...camera.up, 0], 16);
          data.set(
            [
              settings.time,
              SAMPLING_MODES.indexOf(settings.sampling ?? 'nearest'),
              settings.alphaCut ?? 0.5,
              0,
            ],
            28,
          );
          device.queue.writeBuffer(buffer, 0, data);
        },
        destroy: () => buffer.destroy(),
      };
    },
    setSprites(list) {
      if (list.length > maxSprites) {
        throw new Error(`createSpriteBatch: ${list.length} sprites, room for ${maxSprites}`);
      }
      list.forEach((sprite, index) => {
        const layer = art.layers[sprite.sheet];
        if (!layer)
          throw new Error(`Sprite ${index} uses sheet ${sprite.sheet}, which is not loaded`);
        const region = sprite.region ?? [0, 0, layer.width, layer.height];
        const scale = sprite.scale ?? 1;
        const size = sprite.size ?? [region[2] * TEXEL * scale, region[3] * TEXEL * scale];
        const tint = sprite.tint ?? [1, 1, 1];
        instanceData.set(
          [
            ...sprite.position,
            FACING_CODE[sprite.facing ?? 'upright'],
            size[0],
            size[1],
            layer.layer,
            sprite.flipX ? 1 : 0,
            ...region,
            sprite.frames ?? 1,
            sprite.fps ?? 0,
            sprite.start ?? 0,
            sprite.frame ?? 0,
            ...tint,
            sprite.flash ?? 0,
          ],
          index * SPRITE_FLOATS,
        );
      });
      count = list.length;
      if (count) device.queue.writeBuffer(sprites, 0, instanceData, 0, count * SPRITE_FLOATS);
    },
    draw(pass, view, drawOptions = {}) {
      if (!count) return;
      pass.setPipeline(colorPipeline(drawOptions.sampleCount ?? 1, drawOptions.coverage ?? false));
      pass.setBindGroup(0, view.bindGroup);
      pass.setBindGroup(1, resources);
      if (drawOptions.shadeGroup) pass.setBindGroup(2, drawOptions.shadeGroup);
      pass.draw(6, count);
    },
    drawDepth(pass, view, drawOptions) {
      if (!count) return;
      pass.setPipeline(depthPipeline(drawOptions.depthFormat, drawOptions.sampleCount ?? 1));
      pass.setBindGroup(0, view.bindGroup);
      pass.setBindGroup(1, resources);
      pass.draw(6, count);
    },
    destroy() {
      sprites.destroy();
      art.texture.destroy();
      normals.texture.destroy();
    },
  };
}
