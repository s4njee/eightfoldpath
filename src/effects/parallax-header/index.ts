import foregroundUrl from '../../../assets/parallax/foreground.png?url';
import hillsUrl from '../../../assets/parallax/hills.png?url';
import mountainsUrl from '../../../assets/parallax/mountains.png?url';
import skyUrl from '../../../assets/parallax/sky.png?url';
import treelineUrl from '../../../assets/parallax/treeline.png?url';
import { loadPixels, packTextureArray } from '../../gpu/assets.ts';
import { createLayerDof } from '../../gpu/lens/layer-dof.ts';
import { createScreenShafts, SHAFTS_DIVISOR, SHAFTS_FORMAT } from '../../gpu/lens/shafts-screen.ts';
import { bleedColour } from '../../gpu/pixel/mips.ts';
import { trackPointer } from '../../gpu/pointer.ts';
import { createHdrTail, TAIL_PARAMS } from '../../gpu/post/index.ts';
import { createShader, withChunks } from '../../gpu/shader.ts';
import { createUniformBuffer, defineUniformStruct, uniformArray } from '../../gpu/uniforms.ts';
import { defaultInspect, defineEffect } from '../types.ts';
import {
  blurMix,
  createDrift,
  focusParallax,
  LAYERS,
  layerOrigin,
  layerSigma,
  pixelsPerTexel,
} from './depth.ts';
import { meta } from './meta.ts';
import shader from './parallax.wgsl';

const Params = defineUniformStruct('Params', {
  // Per layer, far to near: (origin, size), (blur mix, haze, sigma, depth for the layers view).
  layers: uniformArray('vec4f', LAYERS.length * 2),
  canvas: 'vec2f',
  inv_scale: 'f32',
  view: 'f32',
  sun: 'vec2f',
  sun_radius: 'f32',
  sun_on: 'f32',
  sun_color: 'vec3f',
  sun_intensity: 'f32',
  haze_color: 'vec3f',
  halo: 'f32',
  mask_divisor: 'f32',
  max_sigma: 'f32',
  sampling: 'f32',
});

/** Story 3.1's three ways of reading pixel art, in the order sampling.wgsl numbers them. */
const SAMPLING = ['nearest', 'bilinear', 'sharp'] as const;

const URLS = [skyUrl, mountainsUrl, hillsUrl, treelineUrl, foregroundUrl];
const PARALLAXES = LAYERS.map((layer) => layer.parallax);

/** Views drawn by the composite shader; `occlusion` and `shafts` come from the shafts module. */
const SHADER_VIEWS: Readonly<Record<string, number>> = { layers: 1, 'circle of confusion': 2 };

/** The fewest texels across: the sky's width, so a portrait phone still sees one whole sky. */
const MIN_WIDE_TEXELS = 96;
/** How quickly the view follows the pointer, per second; about a third of a second to settle. */
const POINTER_RATE = 6;
/** Vertical pointer parallax as a share of the horizontal: a header is wide and short. */
const POINTER_VERTICAL = 0.35;

export const effect = defineEffect({
  meta,
  params: {
    drift: {
      type: 'number',
      default: 2,
      min: -12,
      max: 12,
      step: 0.1,
      label: 'drift (texels a second, nearest layer)',
    },
    wind: { type: 'number', default: 0.5, min: -4, max: 4, step: 0.05, label: 'cloud drift' },
    pointer: {
      type: 'number',
      default: 6,
      min: 0,
      max: 16,
      step: 0.5,
      label: 'pointer parallax (texels)',
    },
    scroll: {
      type: 'number',
      default: 10,
      min: 0,
      max: 30,
      step: 0.5,
      label: 'page-scroll parallax (texels)',
    },
    sampling: { type: 'select', default: 'sharp', options: SAMPLING, label: 'sampling (in focus)' },
    viewTexels: { type: 'number', default: 64, min: 40, max: 96, step: 1, label: 'texels tall' },
    focus: {
      type: 'number',
      default: 3,
      min: 0,
      max: 4,
      step: 0.01,
      label: 'focus (0 sky … 4 foreground)',
    },
    aperture: {
      type: 'number',
      default: 1.5,
      min: 0,
      max: 8,
      step: 0.05,
      label: 'aperture (blur texels per unit of depth)',
    },
    haze: { type: 'number', default: 0.3, min: 0, max: 1, step: 0.01, label: 'distance haze' },
    hazeColor: { type: 'color', default: [0.17, 0.32, 0.49], label: 'haze colour' },
    sun: { type: 'boolean', default: true },
    sunX: { type: 'number', default: 0.66, min: 0, max: 1, step: 0.005, label: 'sun across' },
    sunHeight: {
      type: 'number',
      default: 34,
      min: 10,
      max: 70,
      step: 0.5,
      label: 'sun height (texels)',
    },
    sunRadius: { type: 'number', default: 5, min: 1, max: 12, step: 0.5, label: 'sun radius' },
    sunIntensity: {
      type: 'number',
      default: 3,
      min: 0,
      max: 16,
      step: 0.1,
      label: 'sun intensity',
    },
    sunColor: { type: 'color', default: [1, 0.72, 0.4], label: 'sun colour' },
    halo: { type: 'number', default: 0.1, min: 0, max: 0.5, step: 0.005, label: 'sun glow' },
    shafts: { type: 'number', default: 0.8, min: 0, max: 3, step: 0.01, label: 'shaft intensity' },
    shaftReach: { type: 'number', default: 0.85, min: 0, max: 1, step: 0.01, label: 'shaft reach' },
    shaftFalloff: {
      type: 'number',
      default: 0.3,
      min: 0.01,
      max: 1,
      step: 0.01,
      label: 'shaft falloff',
    },
    ...TAIL_PARAMS,
    bloom: { ...TAIL_PARAMS.bloom, default: 0.25 },
    bloomThreshold: { ...TAIL_PARAMS.bloomThreshold, default: 1.5 },
    bloomRadius: { ...TAIL_PARAMS.bloomRadius, default: 0.6 },
  },
  presets: {
    'focus on the foreground': { focus: 4, aperture: 2 },
    'focus on the distance': { focus: 1, aperture: 2.5 },
    'everything sharp': { aperture: 0 },
    'no shafts': { shafts: 0 },
    // The cheapest version: one pass of five sharp layers and the tail.
    plain: { aperture: 0, shafts: 0, sun: false, haze: 0, bloom: 0 },
  },
  inspect: {
    views: ['layers', 'circle of confusion', 'occlusion', 'shafts'],
    stages: ['dof', 'haze', 'shafts', 'bloom'],
  },

  async create({ device, format, hdr, canvas, params, profiler, inspect = defaultInspect() }) {
    const tail = createHdrTail(device, { format, hdr, label: 'parallax-header' });
    const shafts = createScreenShafts(device, {
      format: tail.scene.format,
      label: 'parallax-header shafts',
    });
    const art = await Promise.all(URLS.map((url) => loadPixels(url)));
    // Transparent texels get their opaque neighbours' colour (alpha stays 0), so the bilinear blend
    // at a texel edge fades the colour out instead of mixing in the black they are stored as.
    const layers = art.map((pixels, i) =>
      packTextureArray(device, [bleedColour(pixels)], `parallax-header ${LAYERS[i]!.name}`),
    );
    const blurs = layers.map((layer, i) =>
      createLayerDof(
        device,
        { view: layer.view, width: art[i]!.width, height: art[i]!.height },
        { label: `parallax-header ${LAYERS[i]!.name} dof` },
      ),
    );

    const uniforms = createUniformBuffer(device, Params, 'parallax-header params');
    const sampler = device.createSampler({
      label: 'parallax-header layers',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'repeat',
      addressModeV: 'clamp-to-edge',
    });
    const fragment = { visibility: GPUShaderStage.FRAGMENT };
    const layout = device.createBindGroupLayout({
      label: 'parallax-header',
      entries: [
        { binding: 0, ...fragment, buffer: {} },
        { binding: 1, ...fragment, sampler: {} },
        ...layers.map((_, i) => ({
          binding: 2 + i,
          ...fragment,
          texture: { viewDimension: '2d-array' as const },
        })),
        ...blurs.map((_, i) => ({ binding: 2 + layers.length + i, ...fragment, texture: {} })),
      ],
    });
    const bindGroup = device.createBindGroup({
      label: 'parallax-header',
      layout,
      entries: [
        { binding: 0, resource: { buffer: uniforms.buffer } },
        { binding: 1, resource: sampler },
        ...layers.map((layer, i) => ({ binding: 2 + i, resource: layer.view })),
        ...blurs.map((blur, i) => ({ binding: 2 + layers.length + i, resource: blur.view })),
      ],
    });
    const module = createShader(device, withChunks(shader, { 'params.wgsl': Params.wgsl }));
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const pipeline = (entryPoint: string, target: GPUTextureFormat) =>
      device.createRenderPipeline({
        label: `parallax-header ${entryPoint}`,
        layout: pipelineLayout,
        vertex: { module, entryPoint: 'fullscreen_vs' },
        fragment: { module, entryPoint, targets: [{ format: target }] },
      });
    const composite = pipeline('fs', tail.scene.format);
    const mask = pipeline('fs_mask', SHAFTS_FORMAT);

    const pointer = trackPointer(canvas);
    const drift = createDrift();
    const clouds = createDrift();
    // The pointer's offset from the centre, -1..1 on each axis, eased toward where it is.
    const look = { x: 0, y: 0 };
    let width = 1;
    let height = 1;
    let blurred = 0;

    /** How far the header has scrolled up past the top of the viewport, 0..1 of its height. */
    function scrolled(): number {
      if (params.scroll <= 0) return 0;
      const rect = canvas.getBoundingClientRect();
      return Math.min(Math.max(-rect.top / Math.max(rect.height, 1), 0), 1);
    }

    return {
      resize(w, h) {
        tail.resize(w, h);
        shafts.resize(w, h);
        width = w;
        height = h;
      },
      frame(time, encoder, target) {
        const shaderView = SHADER_VIEWS[inspect.view] ?? 0;
        const scale = pixelsPerTexel(width, height, params.viewTexels, MIN_WIDE_TEXELS);

        // Camera: a steady drift plus the pointer, both in texels of the nearest layer. Easing by
        // `delta` means a still frame (reduced motion, the before/after split) leaves it alone.
        const ease = 1 - Math.exp(-time.delta * POINTER_RATE);
        const toward = pointer.state.inside
          ? { x: pointer.state.x * 2 - 1, y: pointer.state.y * 2 - 1 }
          : { x: 0, y: 0 };
        look.x += (toward.x - look.x) * ease;
        look.y += (toward.y - look.y) * ease;
        const cameraX = drift(time.time, params.drift) + look.x * params.pointer;
        const cameraY = look.y * params.pointer * POINTER_VERTICAL;
        // Scrolling the page lifts the header away; the far layers lag behind the near ones.
        const lag = scrolled() * params.scroll;
        const cloudX = clouds(time.time, params.wind);

        // Depth of field: one blur per layer from its distance to the focus, redone only when
        // that changes (racking the focus, changing the aperture).
        const dofOn = !inspect.off.has('dof');
        const focus = focusParallax(params.focus, PARALLAXES);
        const sigmas = LAYERS.map((layer) =>
          dofOn ? layerSigma(layer.parallax, focus, params.aperture) : 0,
        );
        const mixes = sigmas.map((sigma) => blurMix(sigma));
        blurred = mixes.filter((m) => m > 0).length;
        blurs.forEach((blur, i) => {
          if (mixes[i]! > 0) blur.update(encoder, sigmas[i]!, profiler);
        });

        const hazeOn = !inspect.off.has('haze');
        const packed = LAYERS.flatMap((layer, i) => {
          const size = [art[i]!.width, art[i]!.height] as const;
          const p = layer.parallax;
          const x = p * cameraX + (i === 0 ? cloudX : 0);
          const y = p * cameraY - (1 - p) * lag;
          const origin = layerOrigin(size, layer.bottom, x, y, height, scale);
          // Haze grows with distance; the sky is what the haze is, so it gets none.
          const haze = hazeOn && i > 0 ? params.haze * (1 - p) : 0;
          return [...origin, ...size, mixes[i]!, haze, sigmas[i]!, i / (LAYERS.length - 1)];
        });

        const sunOn = params.sun;
        const sunPixel = [params.sunX * width, height - params.sunHeight * scale] as const;
        uniforms.set({
          layers: packed,
          canvas: [width, height],
          inv_scale: 1 / scale,
          view: shaderView,
          sun: sunPixel,
          sun_radius: params.sunRadius,
          sun_on: sunOn ? 1 : 0,
          sun_color: params.sunColor,
          sun_intensity: params.sunIntensity,
          haze_color: params.hazeColor,
          halo: params.halo,
          mask_divisor: SHAFTS_DIVISOR,
          max_sigma: Math.max(...sigmas),
          sampling: Math.max(SAMPLING.indexOf(params.sampling as (typeof SAMPLING)[number]), 0),
        });
        uniforms.upload();

        const pass = encoder.beginRenderPass({
          label: 'parallax-header layers',
          colorAttachments: [
            { view: tail.scene.view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
          ],
          timestampWrites: profiler.pass('layers'),
        });
        pass.setPipeline(composite);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3);
        pass.end();

        // Light shafts: the occlusion mask at a quarter of the size, blurred toward the sun, added
        // to the HDR scene before the tail so they bloom and tonemap with everything else.
        const shaftView = inspect.view === 'occlusion' || inspect.view === 'shafts';
        const shaftsOn =
          sunOn && params.shafts > 0 && !inspect.off.has('shafts') && shaderView === 0;
        if (shaftsOn || shaftView) {
          const maskPass = encoder.beginRenderPass({
            label: 'parallax-header occlusion',
            colorAttachments: [{ view: shafts.mask.view, loadOp: 'clear', storeOp: 'store' }],
            timestampWrites: profiler.pass('occlusion'),
          });
          maskPass.setPipeline(mask);
          maskPass.setBindGroup(0, bindGroup);
          maskPass.draw(3);
          maskPass.end();
          shafts.encode(
            encoder,
            {
              sun: [sunPixel[0] / width, sunPixel[1] / height],
              reach: params.shaftReach,
              falloff: params.shaftFalloff,
            },
            profiler,
          );
          shafts.composite(
            encoder,
            tail.scene.view,
            shaftView
              ? {
                  intensity: 1,
                  source: inspect.view === 'occlusion' ? 'mask' : 'shafts',
                  alone: true,
                }
              : { intensity: params.shafts },
            profiler,
          );
        }

        // No tonemapping, so the art keeps its colours; the sun goes over 1 and blooms.
        const debug = shaderView > 0 || shaftView;
        tail.encode(encoder, target, time, params, profiler, {
          bloom: debug || inspect.off.has('bloom') ? false : undefined,
          output: { tonemap: 'none' },
        });
      },
      stats() {
        return { 'layers out of focus': blurred };
      },
      destroy() {
        pointer.destroy();
        blurs.forEach((blur) => blur.destroy());
        layers.forEach((layer) => layer.texture.destroy());
        shafts.destroy();
        uniforms.destroy();
        tail.destroy();
      },
    };
  },
});
