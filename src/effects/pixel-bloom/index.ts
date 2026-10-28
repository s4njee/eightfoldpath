import { poseCamera } from '../../gpu/diorama/rig.ts';
import { createDioramaStage, loadSceneArt } from '../../gpu/diorama/stage.ts';
import { TONEMAPPERS, type Tonemapper } from '../../gpu/post/index.ts';
import {
  BLOOM_SOURCES,
  createPostFxTail,
  PIXEL_BLOOM,
  PIXEL_TAIL_PARAMS,
  type BloomSource,
} from '../../gpu/post-fx/index.ts';
import { createRenderTarget } from '../../gpu/targets.ts';
import { VILLAGE_ART, villageScene } from '../diorama/village.ts';
import { defaultInspect, defineEffect } from '../types.ts';
import { meta } from './meta.ts';

/*
 * Story 5.4 on the village at dusk: the two lanterns' glass is the only thing that should glow.
 * The bloom is src/gpu/post-fx/pixel-bloom.ts, which thresholds each texel before the chain
 * averages anything; `source: average` is the stock chain for comparison. The presets are the
 * settings experiments/pixel-bloom-study.test.ts measured.
 */

/** World units across the village that must stay in frame, however narrow the canvas. */
const FRAME_WIDTH = 27;

const isSource = (value: string): value is BloomSource =>
  (BLOOM_SOURCES as readonly string[]).includes(value);
const isTonemapper = (value: string): value is Tonemapper =>
  (TONEMAPPERS as readonly string[]).includes(value);

/** The stock tail's bloom, as `createHdrTail` runs it. */
const STOCK = {
  source: 'average',
  bloom: 0.6,
  bloomThreshold: 1,
  knee: 0.5,
  bloomRadius: 0.7,
  levels: 0,
  fireflyFilter: true,
} as const;

export const effect = defineEffect({
  meta,
  params: {
    source: {
      type: 'select',
      default: PIXEL_BLOOM.source,
      options: BLOOM_SOURCES,
      label: 'threshold each (texel) or the average',
    },
    ...PIXEL_TAIL_PARAMS,
    knee: {
      type: 'number',
      default: PIXEL_BLOOM.knee,
      min: 0,
      max: 2,
      step: 0.01,
      label: 'bloom knee',
    },
    levels: {
      type: 'number',
      default: PIXEL_BLOOM.levels,
      min: -3,
      max: 8,
      step: 1,
      label: 'bloom levels (0 auto, -1 one fewer)',
    },
    fireflyFilter: { type: 'boolean', default: PIXEL_BLOOM.fireflyFilter, label: 'firefly filter' },
    tonemap: { type: 'select', default: 'none', options: TONEMAPPERS },
    glow: { type: 'number', default: 1, min: 0, max: 3, step: 0.01, label: 'lantern glow' },
    sunElevation: {
      type: 'number',
      default: 9,
      min: 2,
      max: 85,
      step: 0.5,
      label: 'sun elevation (degrees)',
    },
    sunAzimuth: {
      type: 'number',
      default: -1.2,
      min: -3.14,
      max: 3.14,
      step: 0.01,
      label: 'sun direction',
    },
    sunIntensity: { type: 'number', default: 0.9, min: 0, max: 3, step: 0.01, label: 'sun' },
    sway: { type: 'number', default: 0.06, min: 0, max: 0.6, step: 0.01, label: 'camera sway' },
    distance: {
      type: 'number',
      default: 1,
      min: 0.3,
      max: 1.5,
      step: 0.01,
      label: 'camera distance (× the scene’s)',
    },
  },
  presets: {
    'pixel bloom': {},
    'tail defaults': STOCK,
    'low threshold': { ...STOCK, bloom: 0.8, bloomThreshold: 0.6 },
    'high threshold, averaged': {
      source: 'average',
      bloomThreshold: PIXEL_BLOOM.threshold,
      knee: PIXEL_BLOOM.knee,
    },
    'wide glow': { bloomRadius: 0.8, levels: 0 },
    midday: { sunElevation: 50, sunAzimuth: 0.75, sunIntensity: 1.4 },
    'midday, tail defaults': { ...STOCK, sunElevation: 50, sunAzimuth: 0.75, sunIntensity: 1.4 },
    'close up': { distance: 0.45, sway: 0 },
    'no bloom': { bloom: 0 },
  },
  inspect: {
    views: ['bloom source', 'bloom alone'],
    stages: ['bloom', 'lantern glow', 'lamps'],
  },

  async create({ device, format, hdr, params, profiler, inspect = defaultInspect() }) {
    const scene = villageScene();
    const tail = createPostFxTail(device, { format, hdr, label: 'pixel-bloom' });
    const stage = createDioramaStage(device, {
      scene,
      art: await loadSceneArt(scene, VILLAGE_ART),
      colorFormat: tail.scene.format,
      label: 'pixel-bloom',
    });
    // The lit scene, when the inspector shows the bloom source instead of it.
    const lit = createRenderTarget(device, {
      label: 'pixel-bloom lit',
      format: tail.scene.format,
      width: 1,
      height: 1,
    });
    let aspect = 1;
    let clock = 0;

    const bloomSettings = () => ({
      source: isSource(params.source) ? params.source : PIXEL_BLOOM.source,
      knee: params.knee,
      levels: params.levels,
      fireflyFilter: params.fireflyFilter,
    });

    return {
      resize(width, height) {
        tail.resize(width, height);
        stage.resize(width, height);
        lit.resize(width, height);
        aspect = width / height;
      },
      frame(time, encoder, target) {
        clock += time.delta;
        const fit = FRAME_WIDTH / (2 * Math.tan((25 * Math.PI) / 360) * aspect);
        const camera = poseCamera(
          {
            ...scene.camera,
            focus: [10.8, 2.6, 8.8],
            yaw: scene.camera.yaw + params.sway * Math.sin(clock * 0.25),
            distance: Math.max(scene.camera.distance, fit) * params.distance,
          },
          aspect,
          'perspective',
        );
        const sourceView = inspect.view === 'bloom source';
        stage.encode(encoder, {
          camera,
          time: time.time,
          target: sourceView ? lit.view : tail.scene.view,
          profiler,
          settings: {
            sunElevation: params.sunElevation,
            sunAzimuth: params.sunAzimuth,
            sunIntensity: params.sunIntensity,
            points: !inspect.off.has('lamps'),
            glow: inspect.off.has('lantern glow') ? 0 : params.glow,
            clear: [0.05, 0.06, 0.1],
          },
        });
        const bloom = { ...bloomSettings(), threshold: params.bloomThreshold };
        // The source view: what the threshold lets through, drawn where the scene would be.
        if (sourceView) tail.bloom.encodeSource(encoder, lit.view, tail.scene.view, bloom);
        const off = sourceView || inspect.off.has('bloom');
        tail.encode(encoder, target, time, params, profiler, {
          bloom: off ? false : bloomSettings(),
          output: {
            tonemap: isTonemapper(params.tonemap) ? params.tonemap : 'none',
            view: inspect.view === 'bloom alone' ? 'bloom' : 'final',
          },
        });
      },
      stats() {
        return {
          source: params.source,
          'bloom levels': params.bloom > 0 ? tail.bloom.levelCount(params.levels) : 0,
        };
      },
      destroy() {
        lit.destroy();
        stage.destroy();
        tail.destroy();
      },
    };
  },
});
