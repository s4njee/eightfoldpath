import {
  createTiltShift,
  maxRadiusPixels,
  type TiltShiftMethod,
  type TiltShiftView,
} from '../../gpu/lens/tilt-shift.ts';
import { poseCamera } from '../../gpu/diorama/rig.ts';
import { createDioramaStage, loadSceneArt } from '../../gpu/diorama/stage.ts';
import { createHdrTail } from '../../gpu/post/index.ts';
import { createRenderTarget } from '../../gpu/targets.ts';
import { VILLAGE_ART, villageScene } from '../diorama/village.ts';
import { defaultInspect, defineEffect } from '../types.ts';
import { meta } from './meta.ts';

/*
 * Story 5.1 on the village (src/effects/diorama): the stage draws the sharp scene and its
 * multisampled depth, the lens (src/gpu/lens/tilt-shift.ts) blurs it by distance, then bloom and
 * output. The focus is given relative to the camera's own focus point, so it follows the camera.
 */

/** World units across the village that must stay in frame, however narrow the canvas. */
const FRAME_WIDTH = 27;

/** Inspector views drawn by the lens, by its own names for them. */
const LENS_VIEWS: Readonly<Record<string, TiltShiftView>> = {
  'circle of confusion': 'coc',
  'near field': 'near',
  'far field': 'far',
};

export const effect = defineEffect({
  meta,
  params: {
    method: { type: 'select', default: 'depth', options: ['depth', 'screen', 'off'] },
    focus: {
      type: 'number',
      default: -2.5,
      min: -15,
      max: 15,
      step: 0.1,
      label: 'focus (from the focus point)',
    },
    focusBand: {
      type: 'number',
      default: 4,
      min: 0,
      max: 20,
      step: 0.1,
      label: 'focus band (world units)',
    },
    nearTransition: {
      type: 'number',
      default: 6,
      min: 0.5,
      max: 20,
      step: 0.1,
      label: 'near transition',
    },
    farTransition: {
      type: 'number',
      default: 6,
      min: 0.5,
      max: 40,
      step: 0.1,
      label: 'far transition',
    },
    maxBlur: {
      type: 'number',
      default: 1.5,
      min: 0,
      max: 4,
      step: 0.05,
      label: 'max blur (% of height)',
    },
    // The screen settings sit near the best fit to this scene's ground (experiments/tilt-shift-study),
    // nudged up so the subject's head stays inside the band.
    line: { type: 'number', default: 0.6, min: 0, max: 1, step: 0.01, label: 'screen: focus line' },
    lineBand: {
      type: 'number',
      default: 0.1,
      min: 0,
      max: 0.4,
      step: 0.005,
      label: 'screen: band half-height',
    },
    lineTransition: {
      type: 'number',
      default: 0.35,
      min: 0.02,
      max: 0.8,
      step: 0.01,
      label: 'screen: transition',
    },
    glow: { type: 'number', default: 1, min: 0, max: 3, step: 0.01, label: 'lantern glow' },
    bloom: { type: 'number', default: 0.5, min: 0, max: 2, step: 0.01 },
    msaa: { type: 'boolean', default: true, label: '4× MSAA (multisampled depth)' },
    cameraYaw: {
      type: 'number',
      default: 0.18,
      min: -1,
      max: 1,
      step: 0.01,
      label: 'camera yaw',
    },
    pitch: { type: 'number', default: 35, min: 10, max: 80, step: 0.5, label: 'camera pitch' },
    fov: { type: 'number', default: 25, min: 10, max: 60, step: 0.5, label: 'field of view' },
  },
  presets: {
    'screen fallback': { method: 'screen' },
    'shallow miniature': { focusBand: 3, nearTransition: 3, farTransition: 3, maxBlur: 2.5 },
    'focus far': { focus: 4, focusBand: 4, nearTransition: 8 },
    'focus near': { focus: -7, focusBand: 3, farTransition: 8 },
    'deep focus': { focusBand: 12, maxBlur: 1 },
    'no lens': { method: 'off' },
    'single-sampled depth': { msaa: false },
  },
  inspect: {
    views: Object.keys(LENS_VIEWS),
    stages: ['depth of field', 'bloom', 'lantern glow'],
  },

  async create({ device, format, hdr, params, profiler, inspect = defaultInspect() }) {
    const tail = createHdrTail(device, { format, hdr, label: 'tilt-shift' });
    const scene = villageScene();
    const stage = createDioramaStage(device, {
      scene,
      art: await loadSceneArt(scene, VILLAGE_ART),
      colorFormat: tail.scene.format,
      label: 'tilt-shift',
    });
    // The sharp scene, which the lens reads and writes into the tail's scene target.
    const sharp = createRenderTarget(device, {
      label: 'tilt-shift sharp',
      format: tail.scene.format,
      width: 1,
      height: 1,
    });
    const lens = createTiltShift(device, { format: tail.scene.format, label: 'tilt-shift' });
    let aspect = 1;
    let height = 1;

    return {
      resize(width, nextHeight) {
        tail.resize(width, nextHeight);
        stage.resize(width, nextHeight);
        sharp.resize(width, nextHeight);
        lens.resize(width, nextHeight);
        aspect = width / nextHeight;
        height = nextHeight;
      },
      frame(time, encoder, target) {
        stage.setSampleCount(params.msaa ? 4 : 1);
        const fit = FRAME_WIDTH / (2 * Math.tan((params.fov * Math.PI) / 360) * aspect);
        const distance = Math.max(scene.camera.distance * (25 / params.fov), fit);
        const camera = poseCamera(
          {
            ...scene.camera,
            yaw: params.cameraYaw,
            pitch: params.pitch,
            fov: params.fov,
            distance,
          },
          aspect,
          'perspective',
        );
        const view = LENS_VIEWS[inspect.view];
        // The lens runs when it is on, and for its own inspector views even when it is not.
        const lensOn =
          view !== undefined || (params.method !== 'off' && !inspect.off.has('depth of field'));
        const method: TiltShiftMethod = params.method === 'screen' ? 'screen' : 'depth';

        stage.encode(encoder, {
          camera,
          time: time.time,
          target: lensOn ? sharp.view : tail.scene.view,
          profiler,
          settings: {
            glow: inspect.off.has('lantern glow') ? 0 : params.glow,
            clear: [0.05, 0.06, 0.1],
          },
        });

        if (lensOn) {
          lens.encode(
            encoder,
            { color: sharp.view, depth: stage.depth, projection: camera.projection },
            tail.scene.view,
            {
              method,
              focusDistance: distance + params.focus,
              focusBand: params.focusBand,
              nearTransition: params.nearTransition,
              farTransition: params.farTransition,
              maxBlur: params.maxBlur / 100,
              line: params.line,
              lineBand: params.lineBand,
              lineTransition: params.lineTransition,
              view: view ?? 'final',
            },
            profiler,
          );
        }

        // Lens views skip bloom, so their values reach the screen as drawn. No tonemapping, so
        // the art keeps its colours; the lanterns' glass clips to white and blooms.
        const bloom = view === undefined && !inspect.off.has('bloom') ? params.bloom : 0;
        tail.encode(
          encoder,
          target,
          time,
          { exposure: 1, bloom, bloomThreshold: 1.5, bloomRadius: 0.55 },
          profiler,
          { output: { tonemap: 'none' } },
        );
      },
      stats() {
        return {
          lens: params.method,
          'max blur (px)': maxRadiusPixels({ maxBlur: params.maxBlur / 100 }, height).toFixed(1),
        };
      },
      destroy() {
        lens.destroy();
        sharp.destroy();
        stage.destroy();
        tail.destroy();
      },
    };
  },
});
