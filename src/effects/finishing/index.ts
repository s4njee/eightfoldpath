import { poseCamera } from '../../gpu/diorama/rig.ts';
import { createDioramaStage, loadSceneArt } from '../../gpu/diorama/stage.ts';
import {
  createGradeLuts,
  createPostFxTail,
  FINISH_DEFAULTS,
  FINISH_PARAMS,
  PIXEL_TAIL_PARAMS,
  type FinishView,
} from '../../gpu/post-fx/index.ts';
import { AREA_LOOKS, TIME_LIGHT, TIME_LOOKS } from '../colour-grading/looks.ts';
import { VILLAGE_ART, villageScene } from '../diorama/village.ts';
import { defaultInspect, defineEffect } from '../types.ts';
import { meta } from './meta.ts';

/*
 * Story 5.8 on the village square at dusk: vignette, film grain and chromatic aberration, the last
 * touches before the canvas, in the same pass as the grade (src/gpu/post-fx/finishing.wgsl). All
 * three are subtle by default; the presets show what each does when it is not.
 */

const VIEWS: readonly FinishView[] = ['vignette', 'grain', 'aberration'];
const isView = (value: string): value is FinishView => (VIEWS as readonly string[]).includes(value);

export const effect = defineEffect({
  meta,
  params: {
    ...FINISH_PARAMS,
    vignetteRadius: {
      type: 'number',
      default: FINISH_DEFAULTS.vignetteRadius,
      min: 0,
      max: 1,
      step: 0.01,
      label: 'vignette starts (0 centre, 1 corner)',
    },
    vignetteSoftness: {
      type: 'number',
      default: FINISH_DEFAULTS.vignetteSoftness,
      min: 0.05,
      max: 1.5,
      step: 0.01,
      label: 'vignette softness',
    },
    grainSize: {
      type: 'number',
      default: FINISH_DEFAULTS.grainSize,
      min: 1,
      max: 6,
      step: 0.1,
      label: 'grain size (px at 1080p)',
    },
    grade: { type: 'boolean', default: true, label: 'dusk grade' },
    sway: { type: 'number', default: 0.06, min: 0, max: 0.6, step: 0.01, label: 'camera sway' },
    ...PIXEL_TAIL_PARAMS,
  },
  presets: {
    subtle: {},
    film: { vignette: 0.4, grain: 7, grainSize: 2, aberration: 3 },
    'old lens': { vignette: 0.6, vignetteRadius: 0.25, aberration: 8, grain: 2 },
    'heavy grain': { grain: 18, grainSize: 2.5 },
    none: { vignette: 0, grain: 0, aberration: 0 },
  },
  inspect: {
    views: VIEWS,
    stages: ['vignette', 'grain', 'chromatic aberration'],
  },

  async create({ device, format, hdr, params, profiler, inspect = defaultInspect() }) {
    const scene = villageScene();
    const tail = createPostFxTail(device, { format, hdr, label: 'finishing' });
    const stage = createDioramaStage(device, {
      scene,
      art: await loadSceneArt(scene, VILLAGE_ART),
      colorFormat: tail.scene.format,
      label: 'finishing',
    });
    const grades = createGradeLuts(device, {
      key: 'dusk',
      looks: [TIME_LOOKS.dusk, AREA_LOOKS['the square']!],
      label: 'finishing',
    });
    const light = TIME_LIGHT.dusk;
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
        const camera = poseCamera(
          {
            ...scene.camera,
            focus: [10.8, 2.4, 9.4],
            yaw: scene.camera.yaw + params.sway * Math.sin(clock * 0.25),
            distance: 34,
          },
          aspect,
          'perspective',
        );
        stage.encode(encoder, {
          camera,
          time: time.time,
          target: tail.scene.view,
          profiler,
          settings: {
            sunElevation: light.sunElevation,
            sunAzimuth: light.sunAzimuth,
            sunIntensity: light.sunIntensity,
            clear: [0.05, 0.06, 0.1],
          },
        });
        const off = inspect.off;
        tail.encode(
          encoder,
          target,
          time,
          { ...params, exposure: params.exposure * light.exposure },
          profiler,
          {
            output: { tonemap: 'none' },
            grade: params.grade ? grades.input : undefined,
            finish: {
              vignette: off.has('vignette') ? 0 : params.vignette,
              vignetteRadius: params.vignetteRadius,
              vignetteSoftness: params.vignetteSoftness,
              grain: off.has('grain') ? 0 : params.grain,
              grainSize: params.grainSize,
              aberration: off.has('chromatic aberration') ? 0 : params.aberration,
              view: isView(inspect.view) ? inspect.view : 'final',
            },
          },
        );
      },
      destroy() {
        grades.destroy();
        stage.destroy();
        tail.destroy();
      },
    };
  },
});
