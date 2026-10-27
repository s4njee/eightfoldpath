/*
 * A diorama stage: a scene's terrain and sprites, lit by its sun, sky and lamps, in two passes.
 *
 *   const stage = await createDioramaStage(device, { scene, art, colorFormat: tail.scene.format });
 *   resize(w, h)  { stage.resize(w, h); }
 *   frame(...)    { stage.encode(encoder, { camera, time, target: tail.scene.view }); then post }
 *   stage.depth   // the scene's depth, multisampled when `sampleCount` is 4, for depth of field
 *
 * One shadow pass from the sun (terrain and sprites both cast), then one scene pass that draws the
 * terrain in one call and the sprites in another, into multisampled targets with alpha-to-coverage
 * on the sprites (story 3.2's default). Effects that stage something in a diorama start here and
 * keep their own work for what is different about them.
 */
import { loadPixels, type Pixels } from '../assets.ts';
import { createShadowMap, SHADOW_PCF_WGSL, type ShadowMap } from '../lighting/shadow-map.ts';
import { normalsFromAlpha, spriteLightShade } from '../lighting/sprite-light.ts';
import type { PassProfiler } from '../profiler.ts';
import { createSpriteBatch, type Sprite, type SpriteBatch } from '../sprites/batch.ts';
import { orthographicCamera, type CameraState } from '../sprites/camera.ts';
import { createSceneTargets } from '../sprites/targets.ts';
import { createUniformBuffer, defineUniformStruct, uniformArray } from '../uniforms.ts';
import lightWgsl from './light.wgsl?raw';
import type { Scene } from './scene.ts';
import shadeWgsl from './shade.wgsl?raw';
import { createTerrain, type Terrain } from './terrain.ts';

export const MAX_POINT_LIGHTS = 8;
/** Sprite sheets a stage can tell apart for glow. */
const MAX_GLOW_SHEETS = 16;

const DioramaLight = defineUniformStruct('DioramaLight', {
  light_view_proj: 'mat4x4f',
  to_sun: 'vec3f',
  view_mode: 'f32',
  sun_color: 'vec3f',
  shadows_on: 'f32',
  sky: 'vec3f',
  points_on: 'f32',
  ground: 'vec3f',
  point_count: 'f32',
  bias: 'f32',
  normal_offset: 'f32',
  pcf_radius: 'f32',
  height_range: 'f32',
  height_step: 'f32',
  // xyz: position, w: range.
  point_position: uniformArray('vec4f', MAX_POINT_LIGHTS),
  // rgb: colour times intensity.
  point_color: uniformArray('vec4f', MAX_POINT_LIGHTS),
  // x: glow strength of each sprite sheet (scene.glow), times the stage's `glow` setting.
  sheet_glow: uniformArray('vec4f', MAX_GLOW_SHEETS),
});

/** The layer inspector's views a stage can draw instead of the finished picture. */
export const STAGE_VIEWS = ['albedo', 'lighting', 'normals', 'heights'] as const;
export type StageView = 'final' | (typeof STAGE_VIEWS)[number];

export interface StageOptions {
  scene: Scene;
  /** The image for every art name in `scene.art`. `loadSceneArt` fetches them from URLs. */
  art: Readonly<Record<string, Pixels>>;
  colorFormat: GPUTextureFormat;
  /** Default 4: multisampled, with alpha-to-coverage on the sprites. */
  sampleCount?: 1 | 4;
  /** Shadow map size. Default 2048. */
  shadowMapSize?: number;
  /** Room for sprites beyond the scene's own, for effects that add some. */
  maxSprites?: number;
  label?: string;
}

export interface StageSettings {
  /** Sun direction and strength, overriding the scene's. Degrees, and radians about +y. */
  sunElevation?: number;
  sunAzimuth?: number;
  sunIntensity?: number;
  shadows?: boolean;
  points?: boolean;
  sprites?: boolean;
  /** Multiplies the scene's glow; 0 turns it off, 1 is as the scene says. Default 1. */
  glow?: number;
  /** Edge treatment of the terrain (TerrainSettings). */
  dither?: number;
  rim?: number;
  view?: StageView;
  /** Linear colour behind the diorama. */
  clear?: readonly [number, number, number];
}

export interface DioramaStage {
  readonly scene: Scene;
  readonly terrain: Terrain;
  readonly sprites: SpriteBatch;
  readonly shadowMap: ShadowMap;
  /** The scene pass's depth: multisampled when `sampleCount` is above 1. Changes on resize. */
  readonly depth: GPUTexture;
  readonly sampleCount: number;
  /** 4 for MSAA with alpha-to-coverage, 1 for neither; changes `depth`. */
  setSampleCount(count: 1 | 4): void;
  /** Sheet index of an art name, for effects that set their own sprites. */
  sheetOf(art: string): number;
  /** Replace the sprites; by default the stage draws the scene's own. */
  setSprites(sprites: readonly Sprite[]): void;
  /** The scene's sprites, as the batcher takes them. */
  sceneSprites(): Sprite[];
  resize(width: number, height: number): void;
  encode(
    encoder: GPUCommandEncoder,
    frame: {
      camera: CameraState;
      time: number;
      target: GPUTextureView;
      settings?: StageSettings;
      profiler?: PassProfiler;
    },
  ): void;
  destroy(): void;
}

/** Fetches every image a scene names, given where each art name lives. */
export async function loadSceneArt(
  scene: Scene,
  urls: Readonly<Record<string, string>>,
): Promise<Record<string, Pixels>> {
  const missing = scene.art.filter((name) => !urls[name]);
  if (missing.length) throw new Error(`No image URL for ${missing.join(', ')}`);
  const images = await Promise.all(scene.art.map((name) => loadPixels(urls[name]!)));
  return Object.fromEntries(scene.art.map((name, i) => [name, images[i]!]));
}

const [TERRAIN_SHADE, SPRITE_SHADE] = shadeWgsl.split('// ---- sprites ----');
/** A stand-in sheet for a scene with no sprites; the batcher needs at least one. */
const blank: Pixels = { width: 1, height: 1, data: new Uint8Array([0, 0, 0, 0]) };

export function createDioramaStage(device: GPUDevice, options: StageOptions): DioramaStage {
  const { scene } = options;
  const label = options.label ?? 'diorama';
  const uniforms = createUniformBuffer(device, DioramaLight, `${label} light`);
  const shadeLayout = device.createBindGroupLayout({
    label: `${label} shade`,
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
    ],
  });
  const common = `${SHADOW_PCF_WGSL}\n${DioramaLight.wgsl}\n${lightWgsl}\n`;
  const terrain = createTerrain(device, {
    scene,
    art: options.art,
    shade: common + TERRAIN_SHADE,
    shadeLayout,
    colorFormat: options.colorFormat,
    label: `${label} terrain`,
  });

  // Sprites: one sheet per art name the scene's sprites use, in a fixed order.
  const spriteArt = [...new Set(scene.sprites.map((sprite) => sprite.art))].sort();
  const sheets = spriteArt.length ? spriteArt.map((name) => options.art[name]!) : [blank];
  const sprites = createSpriteBatch(device, {
    sheets,
    normals: sheets.map((art) => normalsFromAlpha(art, { radius: 5 })),
    shade: spriteLightShade(common + SPRITE_SHADE),
    shadeLayout,
    colorFormat: options.colorFormat,
    maxSprites: Math.max(scene.sprites.length + (options.maxSprites ?? 0), 1),
    label: `${label} sprites`,
  });
  const sheetOf = (art: string) => {
    const index = spriteArt.indexOf(art);
    if (index < 0) throw new Error(`The scene has no sprite art called "${art}"`);
    return index;
  };
  const sceneSprites = (): Sprite[] =>
    scene.sprites.map((sprite) => ({
      sheet: sheetOf(sprite.art),
      position: sprite.position,
      facing: sprite.facing ?? 'upright',
      flipX: sprite.flipX,
      scale: sprite.scale,
      frames: sprite.frames,
      fps: sprite.fps,
      tint: sprite.tint,
      // A strip of frames: the region is the first frame.
      region: sprite.frames
        ? [0, 0, options.art[sprite.art]!.width / sprite.frames, options.art[sprite.art]!.height]
        : undefined,
    }));
  sprites.setSprites(sceneSprites());

  const cameraView = sprites.createView(`${label} camera`);
  const lightView = sprites.createView(`${label} sun`);
  const shadowMap = createShadowMap(device, {
    size: options.shadowMapSize ?? 2048,
    label: `${label} sun`,
  });
  const shadeGroup = device.createBindGroup({
    label: `${label} shade`,
    layout: shadeLayout,
    entries: [
      { binding: 0, resource: { buffer: uniforms.buffer } },
      { binding: 1, resource: shadowMap.view },
      { binding: 2, resource: shadowMap.linear },
    ],
  });
  const targets = createSceneTargets(device, { colorFormat: options.colorFormat });
  targets.setSampleCount(options.sampleCount ?? 4);

  // The sun's view covers the whole scene from any direction.
  const top = Math.max(...scene.cells.map((cell) => cell.steps)) * scene.heightStep;
  const centre = [scene.width / 2, top / 2, scene.depth / 2] as const;
  const extent = Math.hypot(scene.width, scene.depth, top - scene.base) + 2;
  const lightDepth = extent * 2;
  if (spriteArt.length > MAX_GLOW_SHEETS) {
    throw new Error(`A stage takes at most ${MAX_GLOW_SHEETS} kinds of sprite art`);
  }
  const sheetGlow = new Float32Array(MAX_GLOW_SHEETS * 4);
  const points = scene.lights.points.slice(0, MAX_POINT_LIGHTS);
  const pointPosition = new Float32Array(MAX_POINT_LIGHTS * 4);
  const pointColor = new Float32Array(MAX_POINT_LIGHTS * 4);
  points.forEach((point, i) => {
    pointPosition.set([...point.at, point.range], i * 4);
    pointColor.set(
      point.color.map((c) => c * point.intensity),
      i * 4,
    );
  });

  return {
    scene,
    terrain,
    sprites,
    shadowMap,
    get depth() {
      return targets.depth;
    },
    get sampleCount() {
      return targets.sampleCount;
    },
    sheetOf,
    setSampleCount: (count) => targets.setSampleCount(count),
    setSprites: (list) => sprites.setSprites(list),
    sceneSprites,
    resize: (width, height) => targets.resize(width, height),
    encode(encoder, { camera, time, target, settings = {}, profiler }) {
      const sun = scene.lights.sun;
      const elevation = ((settings.sunElevation ?? sun.elevation) * Math.PI) / 180;
      const azimuth = settings.sunAzimuth ?? sun.azimuth;
      const toSun = [
        Math.cos(elevation) * Math.sin(azimuth),
        Math.sin(elevation),
        Math.cos(elevation) * Math.cos(azimuth),
      ] as const;
      const sunCamera = orthographicCamera(
        [-toSun[0], -toSun[1], -toSun[2]],
        centre,
        extent,
        lightDepth,
      );
      const mapTexel = extent / shadowMap.size;
      const intensity =
        (settings.sunIntensity ?? sun.intensity) * Math.max(Math.sin(elevation), 0) ** 0.5;
      const shadows = settings.shadows ?? true;
      spriteArt.forEach(
        (art, i) => (sheetGlow[i * 4] = (scene.glow[art] ?? 0) * (settings.glow ?? 1)),
      );
      uniforms.set({
        light_view_proj: sunCamera.viewProj,
        to_sun: toSun,
        view_mode: STAGE_VIEWS.indexOf(settings.view as (typeof STAGE_VIEWS)[number]) + 1,
        sun_color: sun.color.map((c) => c * intensity) as [number, number, number],
        shadows_on: shadows ? 1 : 0,
        sky: scene.lights.sky,
        points_on: settings.points === false ? 0 : 1,
        ground: scene.lights.ground,
        point_count: points.length,
        bias: (1.5 * mapTexel) / lightDepth,
        normal_offset: 1.5 * mapTexel,
        // About one sprite texel of softness across the 3×3 kernel.
        pcf_radius: Math.max(1 / 16 / 3 / mapTexel, 0.5),
        height_range: Math.max(top, scene.heightStep),
        height_step: scene.heightStep,
        point_position: pointPosition,
        point_color: pointColor,
        sheet_glow: sheetGlow,
      });
      uniforms.upload();
      terrain.update({ dither: settings.dither, rim: settings.rim });
      cameraView.update(camera, { time, sampling: 'sharp', alphaCut: 0.02 });
      lightView.update(sunCamera, { time, sampling: 'nearest', alphaCut: 0.5 });
      const drawSprites = settings.sprites ?? true;

      // No shadow pass at all without shadows: nothing reads the map then, and an empty timed pass
      // misreads on Apple GPUs (src/effects/diorama/notes.md).
      if (shadows) {
        const shadowPass = encoder.beginRenderPass(shadowMap.pass(profiler?.pass('sun shadow')));
        terrain.drawDepth(shadowPass, lightView, { depthFormat: shadowMap.format });
        if (drawSprites)
          sprites.drawDepth(shadowPass, lightView, { depthFormat: shadowMap.format });
        shadowPass.end();
      }

      const clear = settings.clear ?? [0.04, 0.05, 0.09];
      const pass = encoder.beginRenderPass(
        targets.pass(target, [...clear, 1], profiler?.pass('diorama')),
      );
      const draw = { sampleCount: targets.sampleCount, shadeGroup };
      terrain.draw(pass, cameraView, draw);
      if (drawSprites) sprites.draw(pass, cameraView, { ...draw, coverage: true });
      pass.end();
    },
    destroy() {
      cameraView.destroy();
      lightView.destroy();
      terrain.destroy();
      sprites.destroy();
      shadowMap.destroy();
      targets.destroy();
      uniforms.destroy();
    },
  };
}
