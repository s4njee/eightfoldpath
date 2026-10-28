import forestUrl from '../../../assets/illustrations/forest.png?url';
import harbourUrl from '../../../assets/illustrations/harbour.png?url';
import townUrl from '../../../assets/illustrations/town.png?url';
import { loadPixels } from '../../gpu/assets.ts';
import {
  createBlueNoiseTexture,
  createPaletteLutTexture,
  EIGHTFOLD,
} from '../../gpu/palette/index.ts';
import { createHdrTail } from '../../gpu/post/index.ts';
import { createShader, withChunks } from '../../gpu/shader.ts';
import { createTextureFromData } from '../../gpu/texture.ts';
import { createUniformBuffer, defineUniformStruct } from '../../gpu/uniforms.ts';
import { defaultInspect, defineEffect } from '../types.ts';
import { meta } from './meta.ts';
import shader from './pixelate.wgsl';
import {
  blockSteps,
  blockTexels,
  coverScale,
  devicePixels,
  DIRECTIONS,
  easeInOut,
  pixelAmount,
  stateAt,
  STEP_MODES,
  stepToward,
  type Direction,
  type StepMode,
} from './steps.ts';

const Params = defineUniformStruct('Params', {
  centre: 'vec2f',
  picture_size: 'vec2f',
  scale: 'f32',
  block: 'f32',
  detail_lod: 'f32',
  block_lod: 'f32',
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
const DITHERS = ['none', 'bayer', 'blue noise'] as const;
const VIEWS: Readonly<Record<string, number>> = { blocks: 1, error: 2, threshold: 3 };

/**
 * Hover from a mouse or pen, and a tap from a finger, which has no hover: a tap toggles the card
 * between its two ends and a second tap puts it back. A touch that turns into a scroll ends in
 * `pointercancel`, not `pointerup`, so scrolling past a card does not toggle it.
 */
function hoverInput(canvas: HTMLCanvasElement) {
  const state = { inside: false, tapped: false };
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const listen = (type: string, handler: (event: PointerEvent) => void) =>
    canvas.addEventListener(type, handler as EventListener, options);
  listen('pointerenter', (event) => {
    if (event.pointerType !== 'touch') state.inside = true;
  });
  listen('pointerleave', (event) => {
    if (event.pointerType !== 'touch') state.inside = false;
  });
  listen('pointerup', (event) => {
    if (event.pointerType === 'touch') state.tapped = !state.tapped;
  });
  return { state, destroy: () => controller.abort() };
}

export const effect = defineEffect({
  meta,
  params: {
    image: { type: 'select', default: 'town', options: Object.keys(PICTURES) },
    direction: {
      type: 'select',
      default: 'reveal',
      options: DIRECTIONS,
      label: 'on hover (reveal: pixel art at rest)',
    },
    pixelSize: {
      type: 'number',
      default: 4,
      min: 2,
      max: 24,
      step: 1,
      label: 'pixel size (CSS px)',
    },
    steps: { type: 'select', default: 'doubling', options: STEP_MODES, label: 'block steps' },
    duration: {
      type: 'number',
      default: 0.4,
      min: 0,
      max: 1.5,
      step: 0.05,
      label: 'transition (seconds)',
    },
    zoom: { type: 'number', default: 0.04, min: 0, max: 0.15, step: 0.005, label: 'hover zoom' },
    dither: { type: 'select', default: 'bayer', options: DITHERS },
    // Half story 3.5's 0.12: blocks this big make the ordered pattern a visible weave.
    ditherStrength: {
      type: 'number',
      default: 0.06,
      min: 0,
      max: 0.5,
      step: 0.01,
      label: 'dither strength',
    },
    held: { type: 'boolean', default: false, label: 'hovered (for focus, set by the page)' },
  },
  presets: {
    'pixelate on hover': { direction: 'pixelate' },
    'mosaic, a pixel at a time': { steps: 'linear', pixelSize: 8, duration: 0.5 },
    'forest, blue noise': { image: 'forest', dither: 'blue noise' },
    'harbour, chunky, no dither': { image: 'harbour', pixelSize: 10, dither: 'none' },
  },
  inspect: {
    views: ['blocks', 'error', 'threshold'],
    stages: ['palette', 'dither', 'pixelation'],
  },

  async create({ device, format, hdr, canvas, params, profiler, inspect = defaultInspect() }) {
    const tail = createHdrTail(device, { format, hdr, label: 'pixelate-hover' });
    const lut = createPaletteLutTexture(device, EIGHTFOLD);
    const blueNoise = createBlueNoiseTexture(device);
    const sampler = device.createSampler({
      label: 'pixelate-hover picture',
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
    });
    const uniforms = createUniformBuffer(device, Params, 'pixelate-hover params');
    const module = createShader(device, withChunks(shader, { 'params.wgsl': Params.wgsl }));
    const fragment = GPUShaderStage.FRAGMENT;
    const layout = device.createBindGroupLayout({
      label: 'pixelate-hover',
      entries: [
        { binding: 0, visibility: fragment, buffer: {} },
        { binding: 1, visibility: fragment, texture: {} },
        { binding: 2, visibility: fragment, sampler: {} },
        { binding: 3, visibility: fragment, texture: { viewDimension: '3d' } },
        { binding: 4, visibility: fragment, texture: {} },
      ],
    });
    const pipeline = device.createRenderPipeline({
      label: 'pixelate-hover',
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'fullscreen_vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: tail.scene.format }] },
    });

    // Each illustration is 1376 × 768 and about 1.7 MB, so only the one on show is loaded; another
    // loads when picked, and the previous one stays up until it arrives.
    interface Picture {
      texture: GPUTexture;
      size: [number, number];
      group: GPUBindGroup;
    }
    const pictures = new Map<string, Promise<Picture>>();
    let destroyed = false;
    let current: Picture;
    const loadPicture = (name: string): Promise<Picture> => {
      let promise = pictures.get(name);
      if (!promise) {
        promise = loadPixels(PICTURES[name]!).then((pixels) => {
          const texture = createTextureFromData(device, {
            label: `pixelate-hover ${name}`,
            width: pixels.width,
            height: pixels.height,
            format: 'rgba8unorm-srgb',
            data: pixels.data,
            mipmaps: true,
          });
          const group = device.createBindGroup({
            label: `pixelate-hover ${name}`,
            layout,
            entries: [
              { binding: 0, resource: { buffer: uniforms.buffer } },
              { binding: 1, resource: texture.createView() },
              { binding: 2, resource: sampler },
              { binding: 3, resource: lut.createView({ dimension: '3d' }) },
              { binding: 4, resource: blueNoise.createView() },
            ],
          });
          return { texture, size: [pixels.width, pixels.height], group };
        });
        pictures.set(name, promise);
        promise
          .then((picture) => {
            if (destroyed) picture.texture.destroy();
            else if (params.image === name) current = picture;
          })
          .catch((error: unknown) => console.error(error));
      }
      return promise;
    };
    current = await loadPicture(params.image in PICTURES ? params.image : 'town');

    const input = hoverInput(canvas);
    let width = 1;
    let height = 1;
    let dpr = 1;
    // Hover progress, 0..1 before easing. It starts where it rests, so the first frame is still.
    const hovered = () => input.state.inside || input.state.tapped || params.held;
    let hover = hovered() ? 1 : 0;
    let state = 0;
    let blockPixels = 0;

    return {
      resize(w, h, ratio) {
        tail.resize(w, h);
        width = w;
        height = h;
        dpr = ratio;
      },
      frame(time, encoder, target) {
        if (params.image in PICTURES) void loadPicture(params.image);

        hover = stepToward(hover, hovered() ? 1 : 0, time.delta, params.duration);
        const eased = easeInOut(hover);
        const direction = params.direction as Direction;
        const steps = blockSteps(params.pixelSize, params.steps as StepMode);
        state = stateAt(pixelAmount(eased, direction), steps.length);

        // The zoom follows the hover; the blocks are sized for the zoom at the pixel-art end, so
        // that end is crisp in either direction.
        const base = coverScale(width, height, current.size);
        const scale = base * (1 + params.zoom * eased);
        const zoomAtPixelArt = direction === 'reveal' ? 0 : params.zoom;
        let block = 0;
        blockPixels = 0;
        if (state > 0) {
          blockPixels = inspect.off.has('pixelation') ? 1 : devicePixels(steps[state - 1]!, dpr);
          block = blockTexels(blockPixels, base, zoomAtPixelArt);
        }
        const ditherOn = !inspect.off.has('dither');

        uniforms.set({
          centre: [width / 2, height / 2],
          picture_size: current.size,
          scale,
          block,
          // One texel per pixel for the detail. For a block, one level finer than a texel per
          // block: the bilinear footprint then spans about the block, where the full level would
          // average twice its width and wash the colours out before the palette sees them.
          detail_lod: Math.max(0, -Math.log2(scale)),
          block_lod: Math.max(0, Math.log2(Math.max(block, 1)) - 1),
          dither: ditherOn ? DITHERS.indexOf(params.dither as (typeof DITHERS)[number]) : 0,
          strength: ditherOn ? params.ditherStrength : 0,
          mapping: inspect.off.has('palette') ? 0 : 1,
          view: VIEWS[inspect.view] ?? 0,
          error_gain: 8,
        });
        uniforms.upload();

        const pass = encoder.beginRenderPass({
          label: 'pixelate-hover',
          colorAttachments: [
            { view: tail.scene.view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
          ],
          timestampWrites: profiler.pass('pixelate'),
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, current.group);
        pass.draw(3);
        pass.end();

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
      stats() {
        return { step: state, 'block (device px)': blockPixels };
      },
      destroy() {
        destroyed = true;
        input.destroy();
        for (const promise of pictures.values()) {
          void promise.then((picture) => picture.texture.destroy()).catch(() => {});
        }
        lut.destroy();
        blueNoise.destroy();
        uniforms.destroy();
        tail.destroy();
      },
    };
  },
});
