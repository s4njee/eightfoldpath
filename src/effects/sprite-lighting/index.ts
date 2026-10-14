import { mat4, vec4 } from 'wgpu-matrix';
import paletteImage from '../../../assets/palette/eightfold.png?url';
import mage from '../../../assets/sprites/mage.png?url';
import traveller from '../../../assets/sprites/traveller.png?url';
import cobblestone from '../../../assets/tiles/cobblestone.png?url';
import { loadPixels, type Pixels } from '../../gpu/assets.ts';
import {
  flatNormals,
  normalsFromAlpha,
  paletteFromPixels,
  spriteLightShade,
} from '../../gpu/lighting/sprite-light.ts';
import { trackPointer } from '../../gpu/pointer.ts';
import { createHdrTail } from '../../gpu/post/index.ts';
import {
  createSpriteBatch,
  TEXEL,
  type Sprite,
  type SpriteBatch,
} from '../../gpu/sprites/batch.ts';
import { dioramaCamera, framingDistance, type CameraState } from '../../gpu/sprites/camera.ts';
import { createSceneTargets } from '../../gpu/sprites/targets.ts';
import { createUniformBuffer, defineUniformStruct, uniformArray } from '../../gpu/uniforms.ts';
import { defaultInspect, defineEffect } from '../types.ts';
import { meta } from './meta.ts';
import shadeBody from './shade.wgsl?raw';

const MAX_LIGHTS = 3;
const PALETTE_SIZE = 48;

const LightParams = defineUniformStruct('LightParams', {
  // Per light: position + range, colour + intensity, then the column it lights (x, half width).
  lights: uniformArray('vec4f', MAX_LIGHTS * 3),
  ambient: 'vec3f',
  light_count: 'f32',
  rim_direction: 'vec3f',
  rim_strength: 'f32',
  rim_color: 'vec3f',
  rim_power: 'f32',
  bands: 'f32',
  quantise: 'f32',
  view: 'f32',
  lights_on: 'f32',
  marker_layer: 'f32',
  first_marker: 'f32',
  marker_glow: 'f32',
  palette_count: 'f32',
  palette_lab: uniformArray('vec4f', PALETTE_SIZE),
  palette_linear: uniformArray('vec4f', PALETTE_SIZE),
});

/** The three ways of giving a sprite a normal, left to right in the comparison. */
const NORMAL_MODES = ['flat', 'painted', 'automatic'] as const;
type NormalMode = (typeof NORMAL_MODES)[number];
const QUANTISE = ['off', 'steps', 'palette'] as const;

const SHADER_VIEWS: Readonly<Record<string, number>> = { albedo: 1, normals: 2, lighting: 3 };

/** Ground tiles show 96 texels: six world units, one column of the comparison each. */
const TILE = 96;
const COLUMN = TILE * TEXEL;
/** Where each character stands relative to its column's centre. */
const CAST = [
  { x: -0.75, z: 0.35 },
  { x: 1.05, z: -0.45 },
] as const;
/** In front of the characters: the plane the pointer moves the light in. */
const POINTER_PLANE_Z = 1.6;

/** A small opaque disc that marks where a light is. */
function markerPixels(size = 5): Pixels {
  const data = new Uint8Array(size * size * 4);
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inside = Math.hypot(x + 0.5 - r, y + 0.5 - r) <= r;
      data.set([255, 255, 255, inside ? 255 : 0], (y * size + x) * 4);
    }
  }
  return { width: size, height: size, data };
}

/** Where the pointer's ray meets the plane z = `planeZ`, or undefined if it runs parallel. */
function pointerOnPlane(camera: CameraState, x: number, y: number, planeZ: number) {
  const inverse = mat4.inverse(camera.viewProj);
  const ndc = [x * 2 - 1, 1 - y * 2];
  const near = vec4.transformMat4([ndc[0]!, ndc[1]!, 0, 1], inverse);
  const far = vec4.transformMat4([ndc[0]!, ndc[1]!, 1, 1], inverse);
  const a = [near[0]! / near[3]!, near[1]! / near[3]!, near[2]! / near[3]!];
  const b = [far[0]! / far[3]!, far[1]! / far[3]!, far[2]! / far[3]!];
  const dz = b[2]! - a[2]!;
  if (Math.abs(dz) < 1e-6) return undefined;
  const t = (planeZ - a[2]!) / dz;
  return [a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t, planeZ] as const;
}

export const effect = defineEffect({
  meta,
  params: {
    layout: { type: 'select', default: 'compare', options: ['compare', 'single'] },
    normals: {
      type: 'select',
      default: 'automatic',
      options: NORMAL_MODES,
      label: 'normals (single)',
    },
    radius: { type: 'number', default: 5, min: 1, max: 12, step: 0.5, label: 'edge radius' },
    detail: { type: 'number', default: 3, min: 0, max: 10, step: 0.1, label: 'painted relief' },
    quantise: { type: 'select', default: 'steps', options: QUANTISE },
    bands: { type: 'number', default: 3, min: 1, max: 8, step: 1 },
    lightSpeed: { type: 'number', default: 0.5, min: -2, max: 2, step: 0.01, label: 'light speed' },
    lightHeight: {
      type: 'number',
      default: 2.4,
      min: 0.2,
      max: 5,
      step: 0.01,
      label: 'light height',
    },
    lightRadius: {
      type: 'number',
      default: 2.4,
      min: 0.3,
      max: 3,
      step: 0.01,
      label: 'light orbit',
    },
    lightIntensity: {
      type: 'number',
      default: 1.8,
      min: 0,
      max: 10,
      step: 0.1,
      label: 'light intensity',
    },
    lightRange: { type: 'number', default: 6, min: 1, max: 12, step: 0.1, label: 'light range' },
    lightColor: { type: 'color', default: [1, 0.55, 0.25], label: 'light colour' },
    ambient: { type: 'color', default: [0.07, 0.08, 0.16] },
    rim: { type: 'number', default: 1.4, min: 0, max: 4, step: 0.01, label: 'rim strength' },
    rimPower: { type: 'number', default: 2, min: 0.5, max: 8, step: 0.1, label: 'rim power' },
    rimColor: { type: 'color', default: [0.45, 0.65, 1], label: 'rim colour' },
    cameraYaw: {
      type: 'number',
      default: 0,
      min: -1.5,
      max: 1.5,
      step: 0.01,
      label: 'camera yaw',
    },
    pitch: { type: 'number', default: 35, min: 5, max: 85, step: 0.5, label: 'camera pitch' },
    fov: { type: 'number', default: 25, min: 10, max: 60, step: 0.5, label: 'field of view' },
  },
  presets: {
    'smooth light': { quantise: 'off', rim: 0.8 },
    'palette ramps': { quantise: 'palette', bands: 3 },
    'automatic up close': { layout: 'single', normals: 'automatic', quantise: 'steps' },
    backlit: {
      lightHeight: 3.2,
      lightSpeed: 0.25,
      rim: 2,
      ambient: [0.04, 0.05, 0.1],
      lightColor: [0.9, 0.75, 1],
    },
  },
  inspect: {
    views: ['albedo', 'normals', 'lighting'],
    stages: ['lights', 'rim', 'quantise'],
  },

  async create({ device, format, hdr, canvas, params, profiler, inspect = defaultInspect() }) {
    const tail = createHdrTail(device, { format, hdr, label: 'sprite-lighting' });
    const [ground, palettePixels, ...cast] = await Promise.all(
      [cobblestone, paletteImage, traveller, mage].map((url) => loadPixels(url)),
    );
    const palette = paletteFromPixels(palettePixels!);
    const marker = markerPixels();
    const pointer = trackPointer(canvas);

    const uniforms = createUniformBuffer(device, LightParams, 'sprite-lighting lights');
    const shadeLayout = device.createBindGroupLayout({
      label: 'sprite-lighting shade',
      entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {} }],
    });
    const shadeGroup = device.createBindGroup({
      label: 'sprite-lighting shade',
      layout: shadeLayout,
      entries: [{ binding: 0, resource: { buffer: uniforms.buffer } }],
    });
    const shade = spriteLightShade(`${LightParams.wgsl}\n${shadeBody}`);

    // Sheets: the ground, then every character once per normal mode, then the light marker. The
    // art is the same in each copy; only the normal map beside it differs, so one batch draws the
    // whole comparison and the shader never asks which mode a sprite is in.
    const sheetOf = (character: number, mode: number) => 1 + mode * cast.length + character;
    const markerSheet = 1 + NORMAL_MODES.length * cast.length;
    let batch: SpriteBatch | undefined;
    let built = '';
    function build() {
      const key = `${params.radius}/${params.detail}`;
      if (batch && key === built) return batch;
      batch?.destroy();
      const sheets: Pixels[] = [ground!];
      const normals: Pixels[] = [flatNormals(ground!)];
      for (const mode of NORMAL_MODES) {
        for (const art of cast) {
          sheets.push(art!);
          normals.push(
            mode === 'flat'
              ? flatNormals(art!)
              : normalsFromAlpha(art!, {
                  radius: params.radius,
                  detail: mode === 'painted' ? params.detail : 0,
                }),
          );
        }
      }
      sheets.push(marker);
      normals.push(flatNormals(marker));
      batch = createSpriteBatch(device, {
        sheets,
        normals,
        shade,
        shadeLayout,
        colorFormat: tail.scene.format,
        label: 'sprite-lighting',
      });
      built = key;
      return batch;
    }
    let view = build().createView();
    const targets = createSceneTargets(device, { colorFormat: tail.scene.format });
    targets.setSampleCount(4);
    let aspect = 1;
    // Start with the light off to one side, where the three kinds of normal differ most.
    let phase = -0.9;

    return {
      resize(width, height) {
        tail.resize(width, height);
        targets.resize(width, height);
        aspect = width / height;
      },
      frame(time, encoder, target) {
        const previous = batch;
        const current = build();
        if (current !== previous) {
          view.destroy();
          view = current.createView();
        }
        phase += time.delta * params.lightSpeed;
        const compare = params.layout === 'compare';
        const modes: readonly NormalMode[] = compare
          ? NORMAL_MODES
          : [params.normals as NormalMode];
        const columns = modes.map((_, i) => (i - (modes.length - 1) / 2) * COLUMN);

        const camera = dioramaCamera({
          pitch: params.pitch,
          yaw: params.cameraYaw,
          fov: params.fov,
          focus: [0, 1.7, 0],
          distance: framingDistance(params.fov, compare ? 9.5 : 6),
          aspect,
        });

        // One light per column, at the same place relative to its column so the comparison is
        // fair. It orbits on its own, or follows the pointer across the plane in front of the cast.
        let offset: readonly [number, number, number] = [
          Math.cos(phase) * params.lightRadius,
          params.lightHeight + Math.sin(phase * 0.7) * 0.3,
          Math.sin(phase) * params.lightRadius,
        ];
        if (pointer.state.inside) {
          const hit = pointerOnPlane(camera, pointer.state.x, pointer.state.y, POINTER_PLANE_Z);
          if (hit) {
            const nearest = columns.reduce((best, x) =>
              Math.abs(x - hit[0]) < Math.abs(best - hit[0]) ? x : best,
            );
            offset = [hit[0] - nearest, Math.max(0.2, hit[1]), hit[2]];
          }
        }
        const lights = columns.map((x) => [x + offset[0], offset[1], offset[2]] as const);

        const sprites: Sprite[] = columns.map((x) => ({
          sheet: 0,
          position: [x, 0, 0],
          facing: 'ground',
          region: [0, 0, TILE, TILE],
        }));
        modes.forEach((mode, column) => {
          CAST.forEach((place, character) =>
            sprites.push({
              sheet: sheetOf(character, NORMAL_MODES.indexOf(mode)),
              position: [columns[column]! + place.x, 0, place.z],
            }),
          );
        });
        const firstMarker = sprites.length;
        for (const light of lights) {
          sprites.push({
            sheet: markerSheet,
            position: [light[0], light[1] - 0.15, light[2]],
            facing: 'camera',
          });
        }
        current.setSprites(sprites);

        const lightData: number[] = [];
        lights.forEach((light, i) => {
          lightData.push(...light, params.lightRange, ...params.lightColor, params.lightIntensity);
          lightData.push(columns[i]!, compare ? COLUMN / 2 : 1e6, 0, 0);
        });
        // The rim light sits behind the cast and above it, opposite the camera.
        const back = [camera.forward[0], 0, camera.forward[2]];
        const rimDirection = [back[0]! * 0.8, 0.6, back[2]! * 0.8] as const;
        const shaderView = SHADER_VIEWS[inspect.view] ?? 0;
        uniforms.set({
          lights: lightData,
          light_count: lights.length,
          ambient: params.ambient,
          rim_direction: rimDirection,
          rim_strength: inspect.off.has('rim') ? 0 : params.rim,
          rim_color: params.rimColor,
          rim_power: params.rimPower,
          bands: params.bands,
          quantise: inspect.off.has('quantise') ? 0 : QUANTISE.indexOf(params.quantise as never),
          view: shaderView,
          lights_on: inspect.off.has('lights') ? 0 : 1,
          marker_layer: current.layers[markerSheet]!.layer,
          first_marker: firstMarker,
          marker_glow: 6,
          palette_count: Math.min(palette.lab.length, PALETTE_SIZE),
          palette_lab: palette.lab.slice(0, PALETTE_SIZE).flatMap((c) => [...c, 0]),
          palette_linear: palette.linear.slice(0, PALETTE_SIZE).flatMap((c) => [...c, 1]),
        });
        uniforms.upload();
        view.update(camera, { time: time.time, sampling: 'sharp', alphaCut: 0.02 });

        const pass = encoder.beginRenderPass(
          targets.pass(
            tail.scene.view,
            shaderView ? [0, 0, 0, 1] : [0.012, 0.014, 0.03, 1],
            profiler.pass('sprites'),
          ),
        );
        current.draw(pass, view, { sampleCount: targets.sampleCount, coverage: true, shadeGroup });
        pass.end();

        // No tonemapping: the sprites keep the colours they were drawn in (and in palette mode,
        // the palette's exact colours). Only the light markers, far over white, bloom.
        tail.encode(
          encoder,
          target,
          time,
          { exposure: 1, bloom: shaderView ? 0 : 0.5, bloomThreshold: 1.5, bloomRadius: 0.55 },
          profiler,
          // In palette mode the output dither is off too, so palette colours land unchanged.
          { output: { tonemap: 'none', dither: params.quantise === 'palette' ? 0 : undefined } },
        );
      },
      destroy() {
        pointer.destroy();
        view.destroy();
        batch?.destroy();
        targets.destroy();
        uniforms.destroy();
        tail.destroy();
      },
    };
  },
});
