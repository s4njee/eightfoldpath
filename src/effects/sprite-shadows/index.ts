import { mat4 } from 'wgpu-matrix';
import barrel from '../../../assets/sprites/barrel.png?url';
import knight from '../../../assets/sprites/knight.png?url';
import lantern from '../../../assets/sprites/lantern.png?url';
import mage from '../../../assets/sprites/mage.png?url';
import traveller from '../../../assets/sprites/traveller.png?url';
import tree from '../../../assets/sprites/tree.png?url';
import cobblestone from '../../../assets/tiles/cobblestone.png?url';
import grass from '../../../assets/tiles/grass.png?url';
import { loadPixels } from '../../gpu/assets.ts';
import {
  createShadowMap,
  planarProjection,
  SHADOW_PCF_WGSL,
} from '../../gpu/lighting/shadow-map.ts';
import { normalsFromAlpha, spriteLightShade } from '../../gpu/lighting/sprite-light.ts';
import { createHdrTail } from '../../gpu/post/index.ts';
import { createSpriteBatch, TEXEL, type Sprite } from '../../gpu/sprites/batch.ts';
import {
  dioramaCamera,
  framingDistance,
  orthographicCamera,
  type CameraState,
} from '../../gpu/sprites/camera.ts';
import { createSceneTargets } from '../../gpu/sprites/targets.ts';
import { createUniformBuffer, defineUniformStruct, uniformArray } from '../../gpu/uniforms.ts';
import { defaultInspect, defineEffect } from '../types.ts';
import { meta } from './meta.ts';
import shadeBody from './shade.wgsl?raw';

const MAX_BLOBS = 16;

const ShadowParams = defineUniformStruct('ShadowParams', {
  light_view_proj: 'mat4x4f',
  sun_direction: 'vec3f',
  sun_intensity: 'f32',
  sun_color: 'vec3f',
  mode: 'f32',
  ambient: 'vec3f',
  strength: 'f32',
  pcf_radius: 'f32',
  pcf_taps: 'f32',
  pcf_on: 'f32',
  bias: 'f32',
  shadows_on: 'f32',
  sprite_light_on: 'f32',
  view: 'f32',
  blob_count: 'f32',
  // Per caster: feet x, z and the blob's radius.
  blobs: uniformArray('vec4f', MAX_BLOBS),
});

/** The four ways of giving a sprite a shadow, compared in this effect. */
const SHADOW_MODES = ['blob', 'light-facing', 'crossed', 'projected'] as const;
type ShadowMode = (typeof SHADOW_MODES)[number];

/** Ground tiles show 96 texels: six world units. */
const TILE = 96;
const TILE_SIZE = TILE * TEXEL;
/** World units the shadow map covers, and its depth range: the whole diorama with room to spare. */
const LIGHT_EXTENT = 20;
const LIGHT_DEPTH = 40;
/** Projected silhouettes are drawn this far above the ground, so the ground compares behind them. */
const PROJECTED_HEIGHT = 0.02;

const CAST_SHEETS = [traveller, mage, knight, tree, lantern, barrel];
const [TRAVELLER, MAGE, KNIGHT, TREE, LANTERN, BARREL] = CAST_SHEETS.map((_, i) => i) as [
  number,
  number,
  number,
  number,
  number,
  number,
];
/** Who stands where: feet positions in world units. */
const CAST: readonly { sheet: number; at: readonly [number, number] }[] = [
  { sheet: TREE, at: [-5.4, -2.6] },
  { sheet: LANTERN, at: [3.9, -2.2] },
  { sheet: MAGE, at: [-3.0, -0.6] },
  { sheet: KNIGHT, at: [1.4, -0.4] },
  { sheet: TRAVELLER, at: [-0.9, 1.0] },
  { sheet: BARREL, at: [3.6, 1.4] },
];

const SHADER_VIEWS: Readonly<Record<string, number>> = { shadow: 1 };

export const effect = defineEffect({
  meta,
  params: {
    shadow: { type: 'select', default: 'light-facing', options: SHADOW_MODES },
    sunSpeed: { type: 'number', default: 0.2, min: -1, max: 1, step: 0.01, label: 'sun speed' },
    sunElevation: {
      type: 'number',
      default: 40,
      min: 10,
      max: 85,
      step: 0.5,
      label: 'sun elevation (degrees)',
    },
    sunIntensity: {
      type: 'number',
      default: 1.3,
      min: 0,
      max: 4,
      step: 0.01,
      label: 'sun intensity',
    },
    sunColor: { type: 'color', default: [1, 0.9, 0.74], label: 'sun colour' },
    ambient: { type: 'color', default: [0.15, 0.18, 0.3], label: 'sky light' },
    strength: {
      type: 'number',
      default: 0.85,
      min: 0,
      max: 1,
      step: 0.01,
      label: 'shadow strength',
    },
    softness: {
      type: 'number',
      default: 0.06,
      min: 0,
      max: 0.3,
      step: 0.005,
      label: 'PCF softness (world units)',
    },
    taps: { type: 'number', default: 4, min: 1, max: 6, step: 1, label: 'PCF kernel' },
    mapSize: {
      type: 'select',
      default: '1024',
      options: ['512', '1024', '2048'],
      label: 'map size',
    },
    cameraYaw: {
      type: 'number',
      default: 0.2,
      min: -1.5,
      max: 1.5,
      step: 0.01,
      label: 'camera yaw',
    },
    pitch: { type: 'number', default: 35, min: 5, max: 85, step: 0.5, label: 'camera pitch' },
    fov: { type: 'number', default: 25, min: 10, max: 60, step: 0.5, label: 'field of view' },
  },
  presets: {
    blob: { shadow: 'blob' },
    'crossed quads': { shadow: 'crossed' },
    'projected silhouette': { shadow: 'projected' },
    'low sun': { shadow: 'light-facing', sunElevation: 18, sunSpeed: 0.1 },
    'top down': { pitch: 70, fov: 30 },
  },
  inspect: {
    views: ['shadow', 'shadow map'],
    stages: ['shadows', 'pcf', 'sprite light'],
  },

  async create({ device, format, hdr, params, profiler, inspect = defaultInspect() }) {
    const tail = createHdrTail(device, { format, hdr, label: 'sprite-shadows' });
    const [ground, path, ...cast] = await Promise.all(
      [grass, cobblestone, ...CAST_SHEETS].map((url) => loadPixels(url)),
    );

    const uniforms = createUniformBuffer(device, ShadowParams, 'sprite-shadows params');
    const shadeLayout = device.createBindGroupLayout({
      label: 'sprite-shadows shade',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
      ],
    });
    const shade = spriteLightShade(`${SHADOW_PCF_WGSL}\n${ShadowParams.wgsl}\n${shadeBody}`);
    // Two batches: only the cast draws into the shadow map, so the ground never shadows itself
    // (no acne, no bias to tune for it) and a projected silhouette never flattens the ground too.
    const groundBatch = createSpriteBatch(device, {
      sheets: [ground!, path!],
      shade,
      shadeLayout,
      colorFormat: tail.scene.format,
      label: 'sprite-shadows ground',
    });
    const castBatch = createSpriteBatch(device, {
      sheets: cast,
      normals: cast.map((art) => normalsFromAlpha(art, { radius: 5 })),
      shade,
      shadeLayout,
      colorFormat: tail.scene.format,
      label: 'sprite-shadows cast',
    });
    const groundView = groundBatch.createView();
    const castView = castBatch.createView();
    // The shadow pass draws the cast once from the light, or twice for crossed quads.
    const lightViews = [castBatch.createView('light a'), castBatch.createView('light b')];

    const tiles: Sprite[] = [];
    for (const [x, z, sheet] of [
      [-1, -1, 0],
      [0, -1, 1],
      [1, -1, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [1, 0, 0],
    ] as const) {
      tiles.push({
        sheet,
        position: [x * TILE_SIZE, 0, (z + 0.5) * TILE_SIZE],
        facing: 'ground',
        region: [0, 0, TILE, TILE],
      });
    }
    groundBatch.setSprites(tiles);
    castBatch.setSprites(
      CAST.map(({ sheet, at }) => ({ sheet, position: [at[0], 0, at[1]], facing: 'upright' })),
    );
    const blobs = CAST.flatMap(({ sheet, at }) => [
      at[0],
      at[1],
      cast[sheet]!.width * TEXEL * 0.42,
      0,
    ]);

    let shadowMap = createShadowMap(device, { size: Number(params.mapSize), label: 'sun' });
    let shadeGroup: GPUBindGroup;
    function bind() {
      shadeGroup = device.createBindGroup({
        label: 'sprite-shadows shade',
        layout: shadeLayout,
        entries: [
          { binding: 0, resource: { buffer: uniforms.buffer } },
          { binding: 1, resource: shadowMap.view },
          { binding: 2, resource: shadowMap.linear },
          { binding: 3, resource: shadowMap.nearest },
        ],
      });
    }
    bind();

    const targets = createSceneTargets(device, { colorFormat: tail.scene.format });
    targets.setSampleCount(4);
    let aspect = 1;
    // The sun starts off to the side and behind, where the four approaches differ most.
    let azimuth = 2.2;

    return {
      resize(width, height) {
        tail.resize(width, height);
        targets.resize(width, height);
        aspect = width / height;
      },
      frame(time, encoder, target) {
        if (shadowMap.size !== Number(params.mapSize)) {
          shadowMap.destroy();
          shadowMap = createShadowMap(device, { size: Number(params.mapSize), label: 'sun' });
          bind();
        }
        azimuth += time.delta * params.sunSpeed;
        const elevation = (params.sunElevation * Math.PI) / 180;
        const toSun = [
          Math.cos(elevation) * Math.sin(azimuth),
          Math.sin(elevation),
          Math.cos(elevation) * Math.cos(azimuth),
        ] as const;
        const lightDirection = [-toSun[0], -toSun[1], -toSun[2]] as const;
        const mode = params.shadow as ShadowMode;

        const camera = dioramaCamera({
          pitch: params.pitch,
          yaw: params.cameraYaw,
          fov: params.fov,
          focus: [0, 1.2, 0],
          distance: framingDistance(params.fov, 10),
          aspect,
        });
        const sun = orthographicCamera(lightDirection, [0, 1.5, 0], LIGHT_EXTENT, LIGHT_DEPTH);

        // What the shadow pass draws, and the matrix the ground reads the map with.
        const settings = { time: time.time, sampling: 'nearest' as const, alphaCut: 0.5 };
        let receiver = sun.viewProj;
        let passes: CameraState[] = [];
        if (mode === 'light-facing') {
          // Upright sprites turn about the vertical axis toward whatever views them; viewed from
          // the sun, they turn toward the sun and cast their full silhouette.
          passes = [sun];
        } else if (mode === 'crossed') {
          // The quad the camera sees, and one at right angles to it.
          const r = camera.right;
          passes = [
            { ...sun, right: r },
            { ...sun, right: [-r[2], 0, r[0]] },
          ];
        } else if (mode === 'projected') {
          // The silhouette exactly as the camera sees it, flattened along the light onto the
          // ground, recorded in a map looking straight down.
          const above = orthographicCamera([0, -1, 0], [0, 0, 0], LIGHT_EXTENT, LIGHT_DEPTH);
          passes = [
            {
              ...camera,
              viewProj: mat4.multiply(
                above.viewProj,
                planarProjection(lightDirection, PROJECTED_HEIGHT),
              ),
            },
          ];
          receiver = above.viewProj;
        }
        passes.forEach((state, i) => lightViews[i]!.update(state, settings));

        const shaderView = SHADER_VIEWS[inspect.view] ?? 0;
        const shadowsOn = !inspect.off.has('shadows');
        uniforms.set({
          light_view_proj: receiver,
          sun_direction: toSun,
          sun_intensity: params.sunIntensity,
          sun_color: params.sunColor,
          mode: SHADOW_MODES.indexOf(mode),
          ambient: params.ambient,
          strength: params.strength,
          // Tap spacing in map texels; one sprite texel (1/16 unit) of softness by default, so the
          // shadow's edge is about as soft as the art's own.
          pcf_radius: Math.max(
            params.softness / params.taps / (LIGHT_EXTENT / shadowMap.size),
            0.01,
          ),
          pcf_taps: params.taps,
          pcf_on: inspect.off.has('pcf') ? 0 : 1,
          // A few map texels of depth: enough for the feet, where caster and ground meet. The
          // projected map holds nothing but the silhouettes, a hair above the ground, so it needs none.
          bias: mode === 'projected' ? 0 : (3 * LIGHT_EXTENT) / shadowMap.size / LIGHT_DEPTH,
          shadows_on: shadowsOn ? 1 : 0,
          sprite_light_on: inspect.off.has('sprite light') ? 0 : 1,
          view: shaderView,
          blob_count: CAST.length,
          blobs,
        });
        uniforms.upload();
        groundView.update(camera, { time: time.time, sampling: 'sharp', alphaCut: 0.02 });
        castView.update(camera, { time: time.time, sampling: 'sharp', alphaCut: 0.02 });

        // Always clear the map, so switching to blobs leaves nothing stale for the inspector.
        const shadowPass = encoder.beginRenderPass(shadowMap.pass(profiler.pass('shadow map')));
        if (shadowsOn) {
          passes.forEach((_, i) =>
            castBatch.drawDepth(shadowPass, lightViews[i]!, { depthFormat: shadowMap.format }),
          );
        }
        shadowPass.end();

        const pass = encoder.beginRenderPass(
          targets.pass(
            tail.scene.view,
            shaderView ? [0, 0, 0, 1] : [0.05, 0.07, 0.12, 1],
            profiler.pass('scene'),
          ),
        );
        const draw = { sampleCount: targets.sampleCount, coverage: true, shadeGroup };
        groundBatch.draw(pass, groundView, draw);
        castBatch.draw(pass, castView, draw);
        pass.end();

        if (inspect.view === 'shadow map') {
          const debug = encoder.beginRenderPass({
            label: 'shadow map view',
            colorAttachments: [{ view: tail.scene.view, loadOp: 'clear', storeOp: 'store' }],
          });
          shadowMap.drawDebug(debug, tail.scene.format, aspect);
          debug.end();
        }

        // No tonemapping, so the art keeps its colours where the sun falls on it at about 1.
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
        for (const view of [groundView, castView, ...lightViews]) view.destroy();
        groundBatch.destroy();
        castBatch.destroy();
        shadowMap.destroy();
        targets.destroy();
        uniforms.destroy();
        tail.destroy();
      },
    };
  },
});
