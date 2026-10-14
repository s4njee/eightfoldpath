import barrel from '../../../assets/sprites/barrel.png?url';
import boulder from '../../../assets/sprites/boulder.png?url';
import chest from '../../../assets/sprites/chest.png?url';
import knight from '../../../assets/sprites/knight.png?url';
import lantern from '../../../assets/sprites/lantern.png?url';
import mage from '../../../assets/sprites/mage.png?url';
import traveller from '../../../assets/sprites/traveller.png?url';
import tree from '../../../assets/sprites/tree.png?url';
import cobblestone from '../../../assets/tiles/cobblestone.png?url';
import grass from '../../../assets/tiles/grass.png?url';
import { loadPixels } from '../../gpu/assets.ts';
import { createMipSampler, packMippedTextureArray } from '../../gpu/pixel/mips.ts';
import { createHdrTail } from '../../gpu/post/index.ts';
import { resolveShader } from '../../gpu/shader.ts';
import {
  createSpriteBatch,
  TEXEL,
  type SamplingMode,
  type Sprite,
} from '../../gpu/sprites/batch.ts';
import { dioramaCamera, framingDistance } from '../../gpu/sprites/camera.ts';
import { createSceneTargets } from '../../gpu/sprites/targets.ts';
import { defaultInspect, defineEffect } from '../types.ts';
import { meta } from './meta.ts';
import shade from './shade.wgsl';

const SHEETS = [cobblestone, grass, traveller, mage, knight, lantern, barrel, chest, tree, boulder];
const [COBBLES, GRASS, TRAVELLER, MAGE, KNIGHT, LANTERN, BARREL, CHEST, TREE, BOULDER] = SHEETS.map(
  (_, index) => index,
) as number[] as [number, number, number, number, number, number, number, number, number, number];

/** Each ground tile shows 96 of its 99 texels: six world units. */
const TILE = 96;
const TILE_SIZE = TILE * TEXEL;

/** The columns of the comparison, left to right. */
const COMPARED: readonly SamplingMode[] = ['nearest', 'bilinear', 'sharp'];

/** Inspector views drawn by shade.wgsl, by their code there. */
const SHADE_VIEWS: Readonly<Record<string, number>> = { footprint: 1, 'mip level': 2 };

/**
 * A checkerboard of cobbles and grass running away from the camera, so one frame holds art that is
 * magnified several times (the front row) and art that is minified (the far rows), with a few
 * sprites at different depths. Nothing animates: every change between frames is the camera's.
 */
function scene(): Sprite[] {
  const sprites: Sprite[] = [];
  for (let row = 0; row < 10; row++) {
    for (let column = -1; column <= 1; column++) {
      sprites.push({
        sheet: (row + column) % 2 === 0 ? COBBLES : GRASS,
        position: [column * TILE_SIZE, 0, TILE_SIZE - row * TILE_SIZE],
        facing: 'ground',
        region: [0, 0, TILE, TILE],
      });
    }
  }
  const stand = (sheet: number, x: number, z: number): Sprite => ({
    sheet,
    position: [x, 0, z],
    facing: 'upright',
  });
  sprites.push(
    stand(BOULDER, 4, -22),
    stand(TREE, -5, -14),
    stand(LANTERN, 3.2, -8),
    stand(BARREL, -2.6, -4),
    stand(CHEST, 1.4, -2.5),
    stand(KNIGHT, 2.4, -0.6),
    stand(MAGE, -1.8, 0.4),
    stand(TRAVELLER, 0.2, 1.6),
  );
  return sprites;
}

export const effect = defineEffect({
  meta,
  params: {
    sampling: {
      type: 'select',
      default: 'compare',
      options: ['compare', ...COMPARED],
      label: 'sampling (compare: nearest | bilinear | sharp)',
    },
    mipmaps: { type: 'boolean', default: false },
    // −1 measured closest to the supersampled reference (notes.md).
    mipBias: {
      type: 'number',
      default: -1,
      min: -2,
      max: 2,
      step: 0.25,
      label: 'mip bias (levels)',
    },
    motion: { type: 'select', default: 'pan', options: ['pan', 'orbit', 'still'] },
    speed: { type: 'number', default: 0.3, min: 0, max: 3, step: 0.01, label: 'camera speed' },
    framing: {
      type: 'number',
      default: 9,
      min: 2,
      max: 30,
      step: 0.1,
      label: 'framed height (world units)',
    },
    pitch: { type: 'number', default: 35, min: 5, max: 85, step: 0.5, label: 'camera pitch' },
    fov: { type: 'number', default: 25, min: 10, max: 60, step: 0.5, label: 'field of view' },
  },
  presets: {
    'far ground, no mipmaps': { pitch: 20, framing: 16, mipmaps: false },
    'far ground, mipmaps': { pitch: 20, framing: 16, mipmaps: true },
    'close-up': { framing: 2.5, speed: 0.1 },
    orbit: { motion: 'orbit', speed: 0.6 },
  },
  inspect: { views: ['footprint', 'mip level'] },

  async create({ device, format, hdr, params, profiler, inspect = defaultInspect() }) {
    const tail = createHdrTail(device, { format, hdr, label: 'texel-sampling' });
    const sheets = await Promise.all(SHEETS.map((url) => loadPixels(url)));

    // A mipmapped copy of the batcher's texture array, read by shade.wgsl when mipmaps are on.
    const mipped = packMippedTextureArray(device, sheets, 'texel-sampling mipmapped');
    const options = device.createBuffer({
      label: 'texel-sampling options',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const shadeLayout = device.createBindGroupLayout({
      label: 'texel-sampling shade',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: '2d-array' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
      ],
    });
    const shadeGroup = device.createBindGroup({
      label: 'texel-sampling shade',
      layout: shadeLayout,
      entries: [
        { binding: 0, resource: mipped.view },
        { binding: 1, resource: createMipSampler(device) },
        { binding: 2, resource: { buffer: options } },
      ],
    });

    const batch = createSpriteBatch(device, {
      sheets,
      colorFormat: tail.scene.format,
      // The batcher takes the chunk as text, so its own includes are expanded here.
      shade: resolveShader(shade).code,
      shadeLayout,
      label: 'texel-sampling',
    });
    batch.setSprites(scene());
    // One view per column: each holds its own sampling mode and camera aspect.
    const views = COMPARED.map((mode) => batch.createView(`texel-sampling ${mode}`));
    // No MSAA: the comparison is of texture sampling alone, so cut-outs are hard in every column.
    const targets = createSceneTargets(device, { colorFormat: tail.scene.format });
    let width = 1;
    let height = 1;
    let phase = 0;
    let yaw = 0.3;

    return {
      resize(nextWidth, nextHeight) {
        width = nextWidth;
        height = nextHeight;
        tail.resize(width, height);
        targets.resize(width, height);
      },
      frame(time, encoder, target) {
        // Integrated rather than computed from the clock, so changing the speed never jumps.
        if (params.motion === 'pan') phase += (time.delta * params.speed) / 2;
        if (params.motion === 'orbit') yaw += time.delta * params.speed * 0.2;
        const shaderView = SHADE_VIEWS[inspect.view] ?? 0;
        device.queue.writeBuffer(
          options,
          0,
          new Float32Array([params.mipmaps ? 1 : 0, shaderView, params.mipBias, 0]),
        );

        const modes = params.sampling === 'compare' ? COMPARED : [params.sampling as SamplingMode];
        // A dark gap between columns, a pixel at 270 lines and more on bigger canvases.
        const gap = modes.length > 1 ? Math.max(1, Math.round(height / 270)) : 0;
        const pass = encoder.beginRenderPass(
          targets.pass(tail.scene.view, [0.02, 0.022, 0.04, 1], profiler.pass('sprites')),
        );
        modes.forEach((mode, index) => {
          const x0 = Math.round((index * width) / modes.length);
          const x1 = Math.round(((index + 1) * width) / modes.length);
          const view = views[index]!;
          view.update(
            dioramaCamera({
              pitch: params.pitch,
              yaw,
              fov: params.fov,
              // A swing of two world units either side, at `speed` units a second through the middle.
              focus: [Math.sin(phase) * 2, 1, 0],
              distance: framingDistance(params.fov, params.framing),
              aspect: (x1 - x0) / height,
            }),
            { time: 0, sampling: mode, alphaCut: 0.5 },
          );
          pass.setViewport(x0, 0, x1 - x0, height, 0, 1);
          pass.setScissorRect(x0 + gap, 0, Math.max(1, x1 - x0 - 2 * gap), height);
          batch.draw(pass, view, { shadeGroup });
        });
        pass.end();

        // Unlit art: no bloom and no tonemapping, so every column keeps the colours it sampled.
        tail.encode(
          encoder,
          target,
          time,
          { exposure: 1, bloom: 0, bloomThreshold: 1, bloomRadius: 0.5 },
          profiler,
          { bloom: false, output: { tonemap: 'none' } },
        );
      },
      destroy() {
        for (const view of views) view.destroy();
        batch.destroy();
        targets.destroy();
        mipped.texture.destroy();
        options.destroy();
        tail.destroy();
      },
    };
  },
});
