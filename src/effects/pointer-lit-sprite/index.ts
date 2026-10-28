import bustUrl from '../../../assets/ui/traveller-bust.png?url';
import knightUrl from '../../../assets/sprites/knight.png?url';
import travellerUrl from '../../../assets/sprites/traveller.png?url';
import { loadPixels, packTextureArray, type Pixels, type TextureArray } from '../../gpu/assets.ts';
import { normalsFromAlpha } from '../../gpu/lighting/sprite-light.ts';
import { createPaletteLutTexture, EIGHTFOLD } from '../../gpu/palette/index.ts';
import { bleedColour } from '../../gpu/pixel/mips.ts';
import { createHdrTail } from '../../gpu/post/index.ts';
import { createShader, withChunks } from '../../gpu/shader.ts';
import { createUniformBuffer, defineUniformStruct } from '../../gpu/uniforms.ts';
import { defaultInspect, defineEffect } from '../types.ts';
import {
  easeFactor,
  fitPortrait,
  followPointer,
  frameToTexel,
  idleLight,
  pointerTarget,
  type FollowMode,
  type Framing,
  type Vec2,
} from './light.ts';
import { meta } from './meta.ts';
import shader from './portrait.wgsl';
import { createShadeTexture } from './shade-table.ts';

const Params = defineUniformStruct('Params', {
  origin: 'vec2f',
  sprite_size: 'vec2f',
  light: 'vec3f',
  range: 'f32',
  disc: 'vec3f',
  scale: 'f32',
  light_color: 'vec3f',
  intensity: 'f32',
  ambient: 'vec3f',
  rim_strength: 'f32',
  rim_color: 'vec3f',
  rim_power: 'f32',
  rim_direction: 'vec3f',
  bands: 'f32',
  backdrop_color: 'vec3f',
  backdrop_depth: 'f32',
  layer: 'f32',
  backdrop_on: 'f32',
  palette_on: 'f32',
  light_on: 'f32',
  shadow_on: 'f32',
  shadow_strength: 'f32',
  view: 'f32',
});

/** The portrait and two full figures; each sits in the disc its own way. */
const SPRITES: Readonly<Record<string, { url: string; framing: Framing }>> = {
  bust: { url: bustUrl, framing: { fill: 0.86, bottom: 1 } },
  traveller: { url: travellerUrl, framing: { fill: 0.8, bottom: 0.82 } },
  knight: { url: knightUrl, framing: { fill: 0.8, bottom: 0.82 } },
};
const SPRITE_NAMES = Object.keys(SPRITES);
const SHADINGS = ['smooth', 'bands', 'palette'] as const;
const FOLLOW: readonly FollowMode[] = ['page', 'canvas'];
const VIEWS: Readonly<Record<string, number>> = { albedo: 1, normals: 2, lighting: 3 };

/** How far behind the sprite the backdrop is, in frame radii: sets how far the shadow falls. */
const BACKDROP_DEPTH = 0.3;

export const effect = defineEffect({
  meta,
  params: {
    sprite: { type: 'select', default: 'bust', options: SPRITE_NAMES },
    follow: { type: 'select', default: 'page', options: FOLLOW, label: 'follow the pointer on' },
    reach: {
      type: 'number',
      default: 1,
      min: 0,
      max: 3,
      step: 0.05,
      label: 'reach beyond the frame (radii)',
    },
    followRate: {
      type: 'number',
      default: 7,
      min: 0.5,
      max: 30,
      step: 0.5,
      label: 'follow rate (per second)',
    },
    idleSpeed: {
      type: 'number',
      default: 0.45,
      min: 0,
      max: 2,
      step: 0.01,
      label: 'idle drift speed',
    },
    lightHeight: {
      type: 'number',
      default: 0.6,
      min: 0.05,
      max: 2,
      step: 0.01,
      label: 'light height (radii)',
    },
    lightRange: {
      type: 'number',
      default: 2.6,
      min: 0.5,
      max: 6,
      step: 0.05,
      label: 'light range (radii)',
    },
    lightIntensity: {
      type: 'number',
      default: 1.25,
      min: 0,
      max: 5,
      step: 0.05,
      label: 'light intensity',
    },
    lightColor: { type: 'color', default: [1, 0.8, 0.55], label: 'light colour' },
    ambient: { type: 'color', default: [0.2, 0.21, 0.32] },
    shading: { type: 'select', default: 'palette', options: SHADINGS },
    bands: { type: 'number', default: 3, min: 1, max: 8, step: 1 },
    rim: { type: 'number', default: 1.1, min: 0, max: 3, step: 0.01, label: 'rim strength' },
    rimPower: { type: 'number', default: 2, min: 0.5, max: 8, step: 0.1, label: 'rim power' },
    rimColor: { type: 'color', default: [0.45, 0.65, 1], label: 'rim colour' },
    radius: { type: 'number', default: 5, min: 1, max: 12, step: 0.5, label: 'edge radius' },
    backdrop: { type: 'boolean', default: true, label: 'round backdrop' },
    // The palette's mid blue (#234d86), so palette shading starts from a palette colour.
    backdropColor: { type: 'color', default: [0.017, 0.074, 0.238], label: 'backdrop colour' },
    shadow: { type: 'number', default: 0.65, min: 0, max: 1, step: 0.01, label: 'shadow' },
  },
  presets: {
    'smooth light': { shading: 'smooth', rim: 0.8 },
    // Bands without the palette, so the lantern's orange survives.
    lantern: {
      shading: 'bands',
      bands: 4,
      lightColor: [1, 0.55, 0.25],
      lightIntensity: 2.2,
      lightHeight: 0.4,
      ambient: [0.06, 0.07, 0.14],
      backdropColor: [0.03, 0.03, 0.07],
    },
    'full figure': { sprite: 'traveller' },
    'knight, no frame': { sprite: 'knight', backdrop: false, rim: 1.6 },
    'this canvas only': { follow: 'canvas' },
  },
  inspect: {
    views: ['albedo', 'normals', 'lighting'],
    stages: ['light', 'rim', 'shadow', 'bands', 'palette'],
  },

  async create({ device, format, hdr, canvas, params, profiler, inspect = defaultInspect() }) {
    const tail = createHdrTail(device, { format, hdr, label: 'pointer-lit-sprite' });
    const art = await Promise.all(SPRITE_NAMES.map((name) => loadPixels(SPRITES[name]!.url)));
    // Transparent texels take their opaque neighbours' colour (alpha stays 0), so the sharp
    // filter's one-pixel blend at the silhouette fades out instead of mixing in black.
    const colour = packTextureArray(
      device,
      art.map((pixels) => bleedColour(pixels)),
      'portrait art',
    );
    const lut = createPaletteLutTexture(device, EIGHTFOLD);
    const shadeTable = createShadeTexture(device, EIGHTFOLD);
    const uniforms = createUniformBuffer(device, Params, 'pointer-lit-sprite params');
    const sampler = device.createSampler({
      label: 'pointer-lit-sprite art',
      magFilter: 'linear',
      minFilter: 'linear',
    });

    const module = createShader(device, withChunks(shader, { 'params.wgsl': Params.wgsl }));
    const fragment = GPUShaderStage.FRAGMENT;
    const layout = device.createBindGroupLayout({
      label: 'pointer-lit-sprite',
      entries: [
        { binding: 0, visibility: fragment, buffer: {} },
        { binding: 1, visibility: fragment, texture: { viewDimension: '2d-array' } },
        { binding: 2, visibility: fragment, texture: { viewDimension: '2d-array' } },
        { binding: 3, visibility: fragment, sampler: {} },
        { binding: 4, visibility: fragment, texture: { viewDimension: '3d' } },
        { binding: 5, visibility: fragment, texture: {} },
      ],
    });
    const pipeline = device.createRenderPipeline({
      label: 'pointer-lit-sprite',
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'fullscreen_vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: tail.scene.format }] },
    });

    // Automatic normals from each sprite's alpha (story 3.3), rebuilt when the edge radius
    // changes: a few thousand texels, well under a millisecond each.
    let normals: TextureArray | undefined;
    let bindGroup: GPUBindGroup | undefined;
    let builtRadius = Number.NaN;
    function build(): GPUBindGroup {
      if (bindGroup && builtRadius === params.radius) return bindGroup;
      normals?.texture.destroy();
      const maps: Pixels[] = art.map((pixels) =>
        normalsFromAlpha(pixels, { radius: params.radius }),
      );
      normals = packTextureArray(device, maps, 'portrait normals', 'rgba8unorm');
      bindGroup = device.createBindGroup({
        label: 'pointer-lit-sprite',
        layout,
        entries: [
          { binding: 0, resource: { buffer: uniforms.buffer } },
          { binding: 1, resource: colour.view },
          { binding: 2, resource: normals.view },
          { binding: 3, resource: sampler },
          { binding: 4, resource: lut.createView({ dimension: '3d' }) },
          { binding: 5, resource: shadeTable.createView() },
        ],
      });
      builtRadius = params.radius;
      return bindGroup;
    }

    const pointer = followPointer(canvas);
    let width = 1;
    let height = 1;
    // The light in frame units (the disc's centre 0, radius 1, y down), eased toward its target.
    let light: Vec2 | undefined;

    return {
      resize(w, h) {
        tail.resize(w, h);
        width = w;
        height = h;
      },
      frame(time, encoder, target) {
        const group = build();
        const index = Math.max(SPRITE_NAMES.indexOf(params.sprite), 0);
        const layer = colour.layers[index]!;
        const size: Vec2 = [layer.width, layer.height];
        const fit = fitPortrait(width, height, size, SPRITES[SPRITE_NAMES[index]!]!.framing);

        // Toward the pointer when there is one, otherwise along the idle path. Easing by `delta`
        // means a still frame (reduced motion, the before/after split) leaves the light alone.
        const at = pointer.position(params.follow === 'canvas' ? 'canvas' : 'page');
        const goal = at
          ? pointerTarget(at, width, height, fit, params.reach)
          : idleLight(time.time, params.idleSpeed);
        const k = light ? easeFactor(time.delta, params.followRate) : 1;
        const from = light ?? goal;
        light = [from[0] + (goal[0] - from[0]) * k, from[1] + (goal[1] - from[1]) * k];

        // Frame radii to texels, for the heights and distances the shader works in.
        const texels = fit.radius / fit.scale;
        const lightTexel = frameToTexel(light, fit);
        // The rim comes from the side away from the light, a little behind the sprite: a cool
        // kicker on the shadow side, as a two-light portrait is lit. Overhead when the light is
        // dead centre.
        const length = Math.hypot(light[0], light[1]);
        const rimDirection: [number, number, number] =
          length > 1e-3 ? [-light[0] / length, light[1] / length, -0.4] : [0, 1, -0.4];

        const bandsOn = params.shading !== 'smooth' && !inspect.off.has('bands');
        const paletteOn = params.shading === 'palette' && !inspect.off.has('palette');
        uniforms.set({
          origin: fit.origin,
          sprite_size: size,
          light: [lightTexel[0], lightTexel[1], params.lightHeight * texels],
          range: params.lightRange * texels,
          disc: [fit.centre[0], fit.centre[1], fit.radius],
          scale: fit.scale,
          light_color: params.lightColor,
          intensity: params.lightIntensity,
          ambient: params.ambient,
          rim_strength: inspect.off.has('rim') ? 0 : params.rim,
          rim_color: params.rimColor,
          rim_power: params.rimPower,
          rim_direction: rimDirection,
          bands: bandsOn ? params.bands : 0,
          backdrop_color: params.backdropColor,
          backdrop_depth: BACKDROP_DEPTH * texels,
          layer: layer.layer,
          backdrop_on: params.backdrop ? 1 : 0,
          palette_on: paletteOn ? 1 : 0,
          light_on: inspect.off.has('light') ? 0 : 1,
          shadow_on: inspect.off.has('shadow') ? 0 : 1,
          shadow_strength: params.shadow,
          view: VIEWS[inspect.view] ?? 0,
        });
        uniforms.upload();

        const pass = encoder.beginRenderPass({
          label: 'pointer-lit-sprite',
          colorAttachments: [
            { view: tail.scene.view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
          ],
          timestampWrites: profiler.pass('portrait'),
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group);
        pass.draw(3);
        pass.end();

        // No bloom and no tonemap, so palette colours reach the page as they are; the scene's own
        // alpha (`coverage`) keeps the corners outside the disc transparent.
        tail.encode(
          encoder,
          target,
          time,
          { exposure: 1, bloom: 0, bloomThreshold: 1, bloomRadius: 0.5, alpha: 'coverage' },
          profiler,
          { bloom: false, output: { tonemap: 'none', dither: paletteOn ? 0 : undefined } },
        );
      },
      destroy() {
        pointer.destroy();
        normals?.texture.destroy();
        colour.texture.destroy();
        lut.destroy();
        shadeTable.destroy();
        uniforms.destroy();
        tail.destroy();
      },
    };
  },
});
