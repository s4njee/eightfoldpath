import {
  createCameraRig,
  panScale,
  scrollProgress,
  type PathKey,
  type Projection,
} from '../../gpu/diorama/rig.ts';
import { createDioramaStage, loadSceneArt } from '../../gpu/diorama/stage.ts';
import { trackPointer } from '../../gpu/pointer.ts';
import { createHdrTail, TAIL_PARAMS } from '../../gpu/post/index.ts';
import { VILLAGE_ART, villageScene } from '../diorama/village.ts';
import { defineEffect } from '../types.ts';
import { meta } from './meta.ts';

/*
 * Story 4.3: the camera rig (src/gpu/diorama/rig.ts) on the village. In `explore` a drag pans the
 * focus along the ground, the wheel dollies and the camera leans a little toward the pointer. In
 * `path` the camera follows a tour of four poses, driven by the clock or by scrolling: the page's
 * scroll when the canvas moves through the viewport, or the wheel over the canvas when it does not
 * (the gallery's effect page does not scroll). Everything the input asks for is eased by the rig.
 */

const TOUR: readonly PathKey[] = [
  { at: 0, focus: [12, 2, 8.5], yaw: 0.18, pitch: 35, fov: 25, distance: 52 },
  { at: 0.33, focus: [11, 2.6, 9.6], yaw: -0.4, pitch: 26, fov: 25, distance: 22 },
  { at: 0.66, focus: [11, 4, 4.2], yaw: 0.45, pitch: 42, fov: 25, distance: 24 },
  { at: 1, focus: [14, 1.2, 12.8], yaw: 0.85, pitch: 20, fov: 25, distance: 20 },
];

/** Wheel pixels for the whole tour, when the wheel stands in for scrolling. */
const WHEEL_PER_TOUR = 2400;

export const effect = defineEffect({
  meta,
  params: {
    mode: { type: 'select', default: 'explore', options: ['explore', 'path'] },
    drive: {
      type: 'select',
      default: 'time',
      options: ['time', 'scroll'],
      label: 'path driven by',
    },
    tourSeconds: {
      type: 'number',
      default: 30,
      min: 8,
      max: 90,
      step: 1,
      label: 'tour length (seconds)',
    },
    projection: {
      type: 'select',
      default: 'perspective',
      options: ['perspective', 'orthographic'],
    },
    parallax: {
      type: 'number',
      default: 1,
      min: 0,
      max: 3,
      step: 0.05,
      label: 'pointer parallax',
    },
    ease: {
      type: 'number',
      default: 0.25,
      min: 0.02,
      max: 1.5,
      step: 0.01,
      label: 'ease (seconds)',
    },
    ...TAIL_PARAMS,
    bloom: { ...TAIL_PARAMS.bloom, default: 0.3 },
  },
  presets: {
    explore: {},
    'guided tour': { mode: 'path', drive: 'time' },
    'scroll story': { mode: 'path', drive: 'scroll' },
    orthographic: { projection: 'orthographic' },
    'no parallax': { parallax: 0 },
  },

  async create({ device, format, hdr, canvas, params, profiler }) {
    const scene = villageScene();
    const tail = createHdrTail(device, { format, hdr, label: 'camera-rig' });
    const stage = createDioramaStage(device, {
      scene,
      art: await loadSceneArt(scene, VILLAGE_ART),
      colorFormat: tail.scene.format,
    });
    const rig = createCameraRig(scene.camera, {
      bounds: [0, 0, scene.width, scene.depth],
      dollyRange: [0.35, 1.4],
    });
    const pointer = trackPointer(canvas, { capture: true });

    let aspect = 1;
    let tourClock = 0;
    let progress = 0;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (params.mode === 'path' && params.drive === 'scroll') {
        progress = Math.min(Math.max(progress + event.deltaY / WHEEL_PER_TOUR, 0), 1);
      } else if (params.mode === 'explore') {
        rig.dolly(Math.exp(event.deltaY * 0.0015));
      }
    };
    const onScroll = () => {
      if (params.mode !== 'path' || params.drive !== 'scroll') return;
      progress = scrollProgress(canvas.getBoundingClientRect(), window.innerHeight);
    };
    canvas.addEventListener('wheel', onWheel as EventListener, { passive: false });
    const page = typeof window === 'undefined' ? undefined : window;
    page?.addEventListener('scroll', onScroll, { passive: true });
    let lastMode = params.mode;

    return {
      resize(width, height) {
        tail.resize(width, height);
        stage.resize(width, height);
        aspect = width / height;
      },
      frame(time, encoder, target) {
        rig.projection = params.projection as Projection;
        if (params.mode !== lastMode) {
          // Back to the scene's own pose when leaving the tour, so explore starts somewhere known.
          if (params.mode === 'explore') {
            Object.assign(rig.target, { ...scene.camera, focus: [...scene.camera.focus] });
          }
          lastMode = params.mode;
        }
        const { dx, dy } = pointer.takeDelta();
        if (params.mode === 'path') {
          if (params.drive === 'time') {
            // There and back, so the tour never jumps from its last pose to its first.
            tourClock += time.delta / params.tourSeconds;
            progress = 1 - Math.abs(1 - (tourClock % 2));
          }
          rig.follow(TOUR, progress);
        } else if (pointer.state.down) {
          const scale = panScale(rig.pose);
          rig.pan(-dx * scale * aspect, (dy * scale) / Math.sin((rig.pose.pitch * Math.PI) / 180));
        }
        if (pointer.state.inside && !pointer.state.down) {
          rig.parallax(
            (pointer.state.x - 0.5) * 2 * params.parallax,
            (pointer.state.y - 0.5) * 2 * params.parallax,
          );
        } else {
          rig.parallax(0, 0);
        }
        const camera = rig.update(time.delta, aspect, params.ease);
        stage.encode(encoder, {
          camera,
          time: time.time,
          target: tail.scene.view,
          profiler,
          settings: { clear: [0.05, 0.06, 0.1] },
        });
        tail.encode(encoder, target, time, params, profiler);
      },
      stats() {
        return {
          progress: params.mode === 'path' ? progress.toFixed(2) : '–',
          distance: rig.pose.distance.toFixed(1),
        };
      },
      destroy() {
        canvas.removeEventListener('wheel', onWheel as EventListener);
        page?.removeEventListener('scroll', onScroll);
        pointer.destroy();
        stage.destroy();
        tail.destroy();
      },
    };
  },
});
