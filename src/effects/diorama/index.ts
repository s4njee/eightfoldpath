import { poseCamera } from '../../gpu/diorama/rig.ts';
import {
  createDioramaStage,
  loadSceneArt,
  STAGE_VIEWS,
  type StageView,
} from '../../gpu/diorama/stage.ts';
import { createHdrTail, TAIL_PARAMS } from '../../gpu/post/index.ts';
import { defaultInspect, defineEffect } from '../types.ts';
import { meta } from './meta.ts';
import { VILLAGE_ART, villageScene } from './village.ts';

/*
 * Stories 4.1 and 4.2: a scene written by hand (assets/scenes/village.json), laid out by the scene
 * loader and extruded into terrain in one draw call, with its sprites standing on the ground the
 * loader computed. The lighting is the stage's (src/gpu/diorama/stage.ts): a sun with a shadow map,
 * hemisphere ambient and two lamps. The camera sways slowly so the blocks read as solid.
 */

/** World units across the scene that must stay in frame, however narrow the canvas. */
const FRAME_WIDTH = 27;

export const effect = defineEffect({
  meta,
  params: {
    sunElevation: {
      type: 'number',
      default: 38,
      min: 5,
      max: 85,
      step: 0.5,
      label: 'sun elevation (degrees)',
    },
    sunAzimuth: {
      type: 'number',
      default: 0.75,
      min: -3.14,
      max: 3.14,
      step: 0.01,
      label: 'sun direction',
    },
    sunIntensity: { type: 'number', default: 1.25, min: 0, max: 3, step: 0.01, label: 'sun' },
    shadows: { type: 'boolean', default: true },
    lamps: { type: 'boolean', default: true },
    dither: {
      type: 'number',
      default: 3,
      min: 0,
      max: 8,
      step: 1,
      label: 'seam dither (texels)',
    },
    rim: { type: 'number', default: 0.25, min: 0, max: 1, step: 0.01, label: 'ledge rim' },
    sway: { type: 'number', default: 0.12, min: 0, max: 0.6, step: 0.01, label: 'camera sway' },
    yaw: { type: 'number', default: 0.18, min: -1.2, max: 1.2, step: 0.01, label: 'camera yaw' },
    pitch: { type: 'number', default: 35, min: 10, max: 80, step: 0.5, label: 'camera pitch' },
    fov: { type: 'number', default: 25, min: 10, max: 60, step: 0.5, label: 'field of view' },
    ...TAIL_PARAMS,
    exposure: { ...TAIL_PARAMS.exposure, default: 1 },
    bloom: { ...TAIL_PARAMS.bloom, default: 0.3 },
  },
  presets: {
    afternoon: {},
    evening: { sunElevation: 9, sunAzimuth: -1.2, sunIntensity: 0.9, exposure: 1.3, bloom: 0.5 },
    'top down': { pitch: 70, fov: 30, sway: 0 },
    'hard seams': { dither: 0, rim: 0 },
    'no sun': { sunIntensity: 0, shadows: false, exposure: 1.8 },
  },
  inspect: {
    views: [...STAGE_VIEWS, 'shadow map'],
    stages: ['shadows', 'lamps', 'seams', 'rim', 'sprites'],
  },

  async create({ device, format, hdr, params, profiler, inspect = defaultInspect() }) {
    const scene = villageScene();
    const tail = createHdrTail(device, { format, hdr, label: 'diorama' });
    const stage = createDioramaStage(device, {
      scene,
      art: await loadSceneArt(scene, VILLAGE_ART),
      colorFormat: tail.scene.format,
    });
    let aspect = 1;
    let clock = 0;

    return {
      resize(width, height) {
        tail.resize(width, height);
        stage.resize(width, height);
        aspect = width / height;
      },
      frame(time, encoder, target) {
        clock += time.delta;
        const fov = params.fov;
        // Keep the whole width in frame on a narrow canvas: back off until it fits.
        const fit = FRAME_WIDTH / (2 * Math.tan((fov * Math.PI) / 360) * aspect);
        const camera = poseCamera(
          {
            ...scene.camera,
            yaw: params.yaw + params.sway * Math.sin(clock * 0.25),
            pitch: params.pitch,
            fov,
            distance: Math.max(scene.camera.distance * (25 / fov), fit),
          },
          aspect,
          'perspective',
        );
        const view = (STAGE_VIEWS as readonly string[]).includes(inspect.view)
          ? (inspect.view as StageView)
          : 'final';
        stage.encode(encoder, {
          camera,
          time: time.time,
          target: tail.scene.view,
          profiler,
          settings: {
            sunElevation: params.sunElevation,
            sunAzimuth: params.sunAzimuth,
            sunIntensity: params.sunIntensity,
            shadows: params.shadows && !inspect.off.has('shadows'),
            points: params.lamps && !inspect.off.has('lamps'),
            sprites: !inspect.off.has('sprites'),
            dither: inspect.off.has('seams') ? 0 : params.dither,
            rim: inspect.off.has('rim') ? 0 : params.rim,
            view,
            clear: [0.05, 0.06, 0.1],
          },
        });
        if (inspect.view === 'shadow map') {
          const debug = encoder.beginRenderPass({
            label: 'shadow map view',
            colorAttachments: [{ view: tail.scene.view, loadOp: 'clear', storeOp: 'store' }],
          });
          stage.shadowMap.drawDebug(debug, tail.scene.format, aspect);
          debug.end();
        }
        // Data views skip bloom and tonemapping, so their values reach the screen unchanged.
        const plain = view !== 'final' || inspect.view === 'shadow map';
        tail.encode(
          encoder,
          target,
          time,
          params,
          profiler,
          plain ? { bloom: false, output: { tonemap: 'none', exposure: 1 } } : undefined,
        );
      },
      destroy() {
        stage.destroy();
        tail.destroy();
      },
    };
  },
});
