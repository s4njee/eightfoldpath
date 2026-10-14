import barrel from '../../../assets/sprites/barrel.png?url';
import chest from '../../../assets/sprites/chest.png?url';
import knight from '../../../assets/sprites/knight.png?url';
import lantern from '../../../assets/sprites/lantern.png?url';
import mage from '../../../assets/sprites/mage.png?url';
import traveller from '../../../assets/sprites/traveller.png?url';
import cobblestone from '../../../assets/tiles/cobblestone.png?url';
import grass from '../../../assets/tiles/grass.png?url';
import { loadPixels } from '../../gpu/assets.ts';
import { createHdrTail } from '../../gpu/post/index.ts';
import { resolveShader, withChunks } from '../../gpu/shader.ts';
import { createSpriteBatch, TEXEL, type Sprite } from '../../gpu/sprites/batch.ts';
import { dioramaCamera, framingDistance } from '../../gpu/sprites/camera.ts';
import { createSceneTargets } from '../../gpu/sprites/targets.ts';
import { createUniformBuffer, defineUniformStruct } from '../../gpu/uniforms.ts';
import { defaultInspect, defineEffect } from '../types.ts';
import { meta } from './meta.ts';
import shade from './shade.wgsl';

const SHEETS = [cobblestone, grass, traveller, mage, knight, barrel, chest];
const [COBBLES, GRASS, TRAVELLER, MAGE, KNIGHT, BARREL, CHEST] = SHEETS.map(
  (_, index) => index,
) as number[] as [number, number, number, number, number, number, number];

const Lighting = defineUniformStruct('Lighting', {
  shadow_view_proj: 'mat4x4f',
  light_position: 'vec3f',
  light_radius: 'f32',
  light_color: 'vec3f',
  bands: 'f32',
  ambient: 'vec3f',
  wrap: 'f32',
  shadow_bias: 'f32',
  shadow_on: 'f32',
  snap: 'f32',
  view: 'f32',
});

/** Inspector views drawn by shade.wgsl, by their code there. */
const SHADE_VIEWS: Readonly<Record<string, number>> = { lighting: 1, 'texel grid': 2 };

/** Each ground tile shows 96 texels: six world units, so tile edges fall on the texel grid. */
const TILE = 96;
const TILE_SIZE = TILE * TEXEL;
/**
 * The lamp is the head of the lantern sprite (its top 36 rows), floating like a carried lantern;
 * the light sits in its glass, 14 rows above the bottom of that region.
 */
const LAMP_REGION = [0, 0, 27, 36] as const;
const LAMP_FEET = 1.3;
const LAMP_HEIGHT = LAMP_FEET + 14 * TEXEL;
/** The lamp drawn unlit and bright, so the tail's bloom makes it glow. */
const LAMP_SHADE =
  'fn sprite_shade(f: SpriteFragment) -> vec3f {\n  return f.color.rgb * 2.5;\n}\n';
const SHADOW_SIZE = 1024;
const SHADOW_FORMAT: GPUTextureFormat = 'depth32float';

/** Two tiles of ground and a small cast. Tile edges are whole texels apart, so the grid runs on. */
function scene(): Sprite[] {
  const stand = (sheet: number, x: number, z: number, flipX = false): Sprite => ({
    sheet,
    position: [x, 0, z],
    facing: 'upright',
    flipX,
  });
  return [
    {
      sheet: COBBLES,
      position: [-TILE_SIZE / 2, 0, 0],
      facing: 'ground',
      region: [0, 0, TILE, TILE],
    },
    { sheet: GRASS, position: [TILE_SIZE / 2, 0, 0], facing: 'ground', region: [0, 0, TILE, TILE] },
    stand(BARREL, -2.2, -1.6),
    stand(CHEST, 1.1, -1.4),
    stand(MAGE, -1.6, 0.2),
    stand(KNIGHT, 1.9, 0.1, true),
    stand(TRAVELLER, 0.1, 0.9),
  ];
}

export const effect = defineEffect({
  meta,
  params: {
    bands: {
      type: 'number',
      default: 4,
      min: 0,
      max: 12,
      step: 1,
      label: 'light steps (0: smooth)',
    },
    lightSpeed: { type: 'number', default: 0.3, min: -2, max: 2, step: 0.01, label: 'lamp speed' },
    lightRadius: { type: 'number', default: 7, min: 2, max: 14, step: 0.1, label: 'light radius' },
    lightIntensity: {
      type: 'number',
      default: 2.4,
      min: 0,
      max: 10,
      step: 0.05,
      label: 'light intensity',
    },
    lightColor: { type: 'color', default: [1, 0.62, 0.3], label: 'light colour' },
    ambient: { type: 'color', default: [0.05, 0.06, 0.11] },
    framing: {
      type: 'number',
      default: 8,
      min: 2,
      max: 20,
      step: 0.1,
      label: 'framed height (world units)',
    },
    pitch: { type: 'number', default: 35, min: 5, max: 85, step: 0.5, label: 'camera pitch' },
    fov: { type: 'number', default: 25, min: 10, max: 60, step: 0.5, label: 'field of view' },
    exposure: { type: 'number', default: 1, min: 0, max: 4, step: 0.01 },
  },
  presets: {
    'smooth falloff': { bands: 0 },
    'hard steps': { bands: 3, lightIntensity: 3 },
    'close-up': { framing: 3, bands: 5 },
    'wide view': { framing: 14 },
  },
  inspect: {
    views: ['lighting', 'texel grid'],
    stages: ['texel snapping', 'shadows'],
  },

  async create({ device, format, hdr, params, profiler, inspect = defaultInspect() }) {
    const tail = createHdrTail(device, { format, hdr, label: 'texel-lighting' });
    const sheets = await Promise.all(SHEETS.map((url) => loadPixels(url)));
    const lighting = createUniformBuffer(device, Lighting, 'texel-lighting lighting');
    const shadowMap = device.createTexture({
      label: 'texel-lighting shadow map',
      size: [SHADOW_SIZE, SHADOW_SIZE],
      format: SHADOW_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const shadeLayout = device.createBindGroupLayout({
      label: 'texel-lighting shade',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
      ],
    });
    const shadeGroup = device.createBindGroup({
      label: 'texel-lighting shade',
      layout: shadeLayout,
      entries: [
        { binding: 0, resource: { buffer: lighting.buffer } },
        { binding: 1, resource: shadowMap.createView() },
        {
          binding: 2,
          resource: device.createSampler({ label: 'shadow compare', compare: 'less-equal' }),
        },
      ],
    });
    const batch = createSpriteBatch(device, {
      sheets,
      colorFormat: tail.scene.format,
      // The batcher takes the chunk as text, so its includes (and the generated struct) are
      // expanded here.
      shade: resolveShader(withChunks(shade, { 'lighting-params.wgsl': Lighting.wgsl })).code,
      shadeLayout,
      label: 'texel-lighting',
    });
    batch.setSprites(scene());
    // The lamp is a batch of its own: drawn in the colour pass only, so its card never sits in
    // front of the shadow camera that looks out from inside it.
    const lampBatch = createSpriteBatch(device, {
      sheets: [await loadPixels(lantern)],
      colorFormat: tail.scene.format,
      shade: LAMP_SHADE,
      label: 'texel-lighting lamp',
    });
    const lampSpriteView = lampBatch.createView('texel-lighting lamp sprite');
    const view = batch.createView('texel-lighting camera');
    const lampView = batch.createView('texel-lighting lamp');
    const targets = createSceneTargets(device, { colorFormat: tail.scene.format });
    targets.setSampleCount(4);
    let aspect = 1;
    let phase = 0.6;

    return {
      resize(width, height) {
        tail.resize(width, height);
        targets.resize(width, height);
        aspect = width / height;
      },
      frame(time, encoder, target) {
        phase += time.delta * params.lightSpeed;
        const shaderView = SHADE_VIEWS[inspect.view] ?? 0;
        // A loop over the cobbles and the grass, passing in front of the cast and behind it.
        const lamp = [Math.cos(phase) * 3.2, LAMP_HEIGHT, Math.sin(phase) * 2 - 0.2] as const;
        lampBatch.setSprites([
          {
            sheet: 0,
            position: [lamp[0], LAMP_FEET, lamp[2]],
            facing: 'camera',
            region: LAMP_REGION,
          },
        ]);

        // The shadow camera sits at the light and looks at the middle of the scene; upright cards
        // turn to face it, so each casts its silhouette as seen from the lamp.
        const toLamp = [lamp[0], lamp[1] - 0.5, lamp[2]] as const;
        const distance = Math.hypot(...toLamp);
        const lampCamera = dioramaCamera({
          pitch: (Math.asin(toLamp[1] / distance) * 180) / Math.PI,
          yaw: Math.atan2(toLamp[0], toLamp[2]),
          fov: 120,
          focus: [0, 0.5, 0],
          distance,
          aspect: 1,
          near: 0.2,
          far: 40,
        });
        lampView.update(lampCamera, { time: 0, sampling: 'nearest' });
        const camera = dioramaCamera({
          pitch: params.pitch,
          yaw: 0.25,
          fov: params.fov,
          focus: [0, 1.1, 0],
          distance: framingDistance(params.fov, params.framing),
          aspect,
        });
        // Sharp sampling, the default story 3.1 settled on; the lamp stays out of the debug views.
        view.update(camera, { time: 0, sampling: 'sharp', alphaCut: 0.02 });
        lampSpriteView.update(camera, { time: 0, sampling: 'sharp', alphaCut: 0.02 });
        lighting.set({
          shadow_view_proj: lampCamera.viewProj,
          light_position: lamp,
          light_radius: params.lightRadius,
          light_color: params.lightColor.map((c) => c * params.lightIntensity) as [
            number,
            number,
            number,
          ],
          bands: params.bands,
          ambient: params.ambient,
          wrap: 0.6,
          shadow_bias: 0.04,
          shadow_on: inspect.off.has('shadows') ? 0 : 1,
          snap: inspect.off.has('texel snapping') ? 0 : 1,
          view: shaderView,
        });
        lighting.upload();

        const shadowPass = encoder.beginRenderPass({
          label: 'texel-lighting shadow',
          colorAttachments: [],
          depthStencilAttachment: {
            view: shadowMap.createView(),
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
            depthClearValue: 1,
          },
          timestampWrites: profiler.pass('shadow'),
        });
        batch.drawDepth(shadowPass, lampView, { depthFormat: SHADOW_FORMAT });
        shadowPass.end();

        const pass = encoder.beginRenderPass(
          targets.pass(tail.scene.view, [0.004, 0.005, 0.012, 1], profiler.pass('sprites')),
        );
        batch.draw(pass, view, { sampleCount: targets.sampleCount, coverage: true, shadeGroup });
        if (!shaderView) {
          lampBatch.draw(pass, lampSpriteView, {
            sampleCount: targets.sampleCount,
            coverage: true,
          });
        }
        pass.end();

        // A little bloom for the lamp; the debug views go straight through.
        tail.encode(
          encoder,
          target,
          time,
          { exposure: params.exposure, bloom: 0.35, bloomThreshold: 1, bloomRadius: 0.6 },
          profiler,
          shaderView ? { bloom: false, output: { tonemap: 'none', exposure: 1 } } : undefined,
        );
      },
      destroy() {
        view.destroy();
        lampView.destroy();
        lampSpriteView.destroy();
        batch.destroy();
        lampBatch.destroy();
        targets.destroy();
        shadowMap.destroy();
        lighting.destroy();
        tail.destroy();
      },
    };
  },
});
