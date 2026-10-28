import { createBokeh } from '../../gpu/lens/bokeh.ts';
import { createTiltShift, maxRadiusPixels, type TiltShiftView } from '../../gpu/lens/tilt-shift.ts';
import { poseCamera } from '../../gpu/diorama/rig.ts';
import { createDioramaStage, loadSceneArt } from '../../gpu/diorama/stage.ts';
import { createHdrTail } from '../../gpu/post/index.ts';
import { createRenderTarget } from '../../gpu/targets.ts';
import { VILLAGE_ART } from '../diorama/village.ts';
import { defaultInspect, defineEffect } from '../types.ts';
import { meta } from './meta.ts';
import { NIGHT_LIGHT_COUNT, nightLights, nightVillageScene } from './night.ts';

/*
 * Story 5.2 on the village at night (night.ts): the stage draws the sharp scene, the tilt-shift
 * lens (src/gpu/lens/tilt-shift.ts) blurs it by depth while holding the light of bright blurred
 * blocks back, and the bokeh pass (src/gpu/lens/bokeh.ts) draws that light as discs of the
 * aperture's shape onto the lens's output. Then bloom and output, as in `tilt-shift`.
 */

/** World units across the village that must stay in frame, however narrow the canvas. */
const FRAME_WIDTH = 27;

/** Inspector views drawn by the lens. */
const LENS_VIEWS: Readonly<Record<string, TiltShiftView>> = { 'circle of confusion': 'coc' };

export const effect = defineEffect({
  meta,
  params: {
    bokeh: { type: 'boolean', default: true, label: 'shaped bokeh' },
    blades: { type: 'number', default: 6, min: 0, max: 9, step: 1, label: 'blades (0 round)' },
    rotation: { type: 'number', default: 0, min: 0, max: 90, step: 1, label: 'blade rotation (°)' },
    curvature: { type: 'number', default: 0.1, min: 0, max: 1, step: 0.01, label: 'blade curve' },
    rim: { type: 'number', default: 0.25, min: -0.5, max: 1, step: 0.01, label: 'bright rim' },
    catEye: { type: 'number', default: 0.35, min: 0, max: 1, step: 0.01, label: "cat's eye" },
    threshold: {
      type: 'number',
      default: 1,
      min: 0.25,
      max: 4,
      step: 0.05,
      label: 'highlight threshold',
    },
    intensity: { type: 'number', default: 1, min: 0, max: 4, step: 0.05, label: 'disc intensity' },
    focus: {
      type: 'number',
      default: -2.5,
      min: -15,
      max: 15,
      step: 0.1,
      label: 'focus (from the focus point)',
    },
    focusBand: { type: 'number', default: 4, min: 0, max: 20, step: 0.1, label: 'focus band' },
    nearTransition: {
      type: 'number',
      default: 4,
      min: 0.5,
      max: 20,
      step: 0.1,
      label: 'near transition',
    },
    farTransition: {
      type: 'number',
      default: 4,
      min: 0.5,
      max: 40,
      step: 0.1,
      label: 'far transition',
    },
    maxBlur: {
      type: 'number',
      default: 3.5,
      min: 0,
      max: 4.4,
      step: 0.05,
      label: 'max blur (% of height)',
    },
    glow: { type: 'number', default: 1, min: 0, max: 3, step: 0.01, label: 'lantern glow' },
    moonlight: { type: 'number', default: 0.25, min: 0, max: 1.5, step: 0.01 },
    bloom: { type: 'number', default: 0.35, min: 0, max: 2, step: 0.01 },
  },
  presets: {
    hexagon: {},
    round: { blades: 0, rim: 0.1 },
    'pentagon, straight blades': { blades: 5, rotation: 18, curvature: 0, rim: 0 },
    'soap bubble': { blades: 0, rim: 0.9, catEye: 0 },
    "cat's eye": { blades: 0, rim: 0, catEye: 1, maxBlur: 4.4 },
    'focus far': { focus: 5, focusBand: 3, nearTransition: 6 },
    'gather only': { bokeh: false },
  },
  inspect: {
    views: [...Object.keys(LENS_VIEWS), 'bokeh alone'],
    stages: ['shaped bokeh', 'depth of field', 'bloom', 'lantern glow'],
  },

  async create({ device, format, hdr, params, profiler, inspect = defaultInspect() }) {
    const tail = createHdrTail(device, { format, hdr, label: 'bokeh-highlights' });
    const scene = nightVillageScene();
    const stage = createDioramaStage(device, {
      scene,
      art: await loadSceneArt(scene, VILLAGE_ART),
      colorFormat: tail.scene.format,
      maxSprites: NIGHT_LIGHT_COUNT,
      label: 'bokeh-highlights',
    });
    stage.setSprites([...stage.sceneSprites(), ...nightLights(scene, stage.sheetOf('lantern'))]);
    const sharp = createRenderTarget(device, {
      label: 'bokeh-highlights sharp',
      format: tail.scene.format,
      width: 1,
      height: 1,
    });
    const lens = createTiltShift(device, { format: tail.scene.format, label: 'bokeh-highlights' });
    const bokeh = createBokeh(device, { format: tail.scene.format, label: 'bokeh-highlights' });
    let aspect = 1;
    let height = 1;

    return {
      resize(width, nextHeight) {
        tail.resize(width, nextHeight);
        stage.resize(width, nextHeight);
        sharp.resize(width, nextHeight);
        lens.resize(width, nextHeight);
        bokeh.resize(width, nextHeight);
        aspect = width / nextHeight;
        height = nextHeight;
      },
      frame(time, encoder, target) {
        const fit = FRAME_WIDTH / (2 * Math.tan((scene.camera.fov * Math.PI) / 360) * aspect);
        const distance = Math.max(scene.camera.distance, fit);
        const camera = poseCamera({ ...scene.camera, distance }, aspect, 'perspective');
        const lensView = LENS_VIEWS[inspect.view];
        const alone = inspect.view === 'bokeh alone';
        const lensOn = lensView !== undefined || alone || !inspect.off.has('depth of field');
        const bokehOn =
          lensOn && lensView === undefined && params.bokeh && !inspect.off.has('shaped bokeh');

        stage.encode(encoder, {
          camera,
          time: time.time,
          target: lensOn ? sharp.view : tail.scene.view,
          profiler,
          settings: {
            glow: inspect.off.has('lantern glow') ? 0 : params.glow,
            sunIntensity: params.moonlight,
            clear: [0.008, 0.01, 0.025],
          },
        });

        if (lensOn) {
          lens.encode(
            encoder,
            { color: sharp.view, depth: stage.depth, projection: camera.projection },
            tail.scene.view,
            {
              method: 'depth',
              focusDistance: distance + params.focus,
              focusBand: params.focusBand,
              nearTransition: params.nearTransition,
              farTransition: params.farTransition,
              maxBlur: params.maxBlur / 100,
              line: 0.5,
              lineBand: 0.1,
              lineTransition: 0.3,
              view: lensView ?? 'final',
              // Held back only when the bokeh pass will draw it.
              bokehThreshold: bokehOn || alone ? params.threshold : 0,
            },
            profiler,
          );
        }
        if (bokehOn || alone) {
          bokeh.encode(
            encoder,
            { color: sharp.view, prefiltered: lens.prefiltered },
            tail.scene.view,
            {
              threshold: params.threshold,
              blades: params.blades,
              rotation: params.rotation,
              curvature: params.curvature,
              rim: params.rim,
              catEye: params.catEye,
              intensity: params.intensity,
              alone,
            },
            profiler,
          );
        }

        // Inspector views skip bloom, so their values reach the screen as drawn.
        const bloom = inspect.view === 'final' && !inspect.off.has('bloom') ? params.bloom : 0;
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
          bokeh: params.bokeh
            ? `${Math.round(params.blades) < 3 ? 'round' : params.blades}`
            : 'off',
          'max blur (px)': maxRadiusPixels({ maxBlur: params.maxBlur / 100 }, height).toFixed(1),
        };
      },
      destroy() {
        bokeh.destroy();
        lens.destroy();
        sharp.destroy();
        stage.destroy();
        tail.destroy();
      },
    };
  },
});
