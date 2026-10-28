import village from '../../../assets/scenes/village.json';
import { parseScene, type SceneSource } from '../../gpu/diorama/scene.ts';
import { poseCamera, scrollProgress } from '../../gpu/diorama/rig.ts';
import { createDioramaStage, loadSceneArt } from '../../gpu/diorama/stage.ts';
import {
  createRackFocus,
  pickSubject,
  scheduledSubject,
  scrolledSubject,
} from '../../gpu/lens/rack-focus.ts';
import { createTiltShift, viewDistance, type TiltShiftView } from '../../gpu/lens/tilt-shift.ts';
import { trackPointer } from '../../gpu/pointer.ts';
import { createHdrTail } from '../../gpu/post/index.ts';
import { createRenderTarget } from '../../gpu/targets.ts';
import { VILLAGE_ART } from '../diorama/village.ts';
import { defaultInspect, defineEffect } from '../types.ts';
import { meta } from './meta.ts';

/*
 * Story 5.3 on the village: the rack-focus driver (src/gpu/lens/rack-focus.ts) moves the tilt-shift
 * lens's focus distance between the characters, chosen by the clock, by scrolling, or by clicking
 * one. Each frame the chosen character's distance along the view axis is the target, so the focus
 * would follow a moving camera; the driver eases to it over `duration` seconds, or jumps under
 * reduced motion. A traveller is added on the back terrace so there is someone far away to focus on.
 */

/** World units across the village that must stay in frame, however narrow the canvas. */
const FRAME_WIDTH = 27;
/** Wheel pixels for the whole list, when the wheel stands in for scrolling. */
const WHEEL_PER_LIST = 2400;

/** Who the focus moves between, in the schedule's order: far, near and in between. */
const SUBJECTS = [
  { name: 'traveller on the terrace', at: [12.8, 2.6], height: 68 },
  { name: 'traveller', at: [14, 13.3], height: 68 },
  { name: 'knight', at: [15.4, 10.5], height: 75 },
  { name: 'slime', at: [6.2, 13.4], height: 24 },
  { name: 'mage', at: [7.4, 9.6], height: 46 },
] as const;

const LENS_VIEWS: Readonly<Record<string, TiltShiftView>> = { 'circle of confusion': 'coc' };

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export const effect = defineEffect({
  meta,
  params: {
    drive: {
      type: 'select',
      default: 'time',
      options: ['time', 'scroll', 'click'],
      label: 'focus driven by',
    },
    hold: {
      type: 'number',
      default: 3,
      min: 0.5,
      max: 10,
      step: 0.1,
      label: 'hold (seconds per subject)',
    },
    duration: {
      type: 'number',
      default: 1.2,
      min: 0,
      max: 4,
      step: 0.05,
      label: 'rack (seconds)',
    },
    reducedMotion: { type: 'boolean', default: false, label: 'reduced motion (jump)' },
    focus: {
      type: 'number',
      default: -2.5,
      min: -15,
      max: 15,
      step: 0.1,
      label: 'fixed focus (rack off)',
    },
    focusBand: { type: 'number', default: 3, min: 0, max: 20, step: 0.1, label: 'focus band' },
    nearTransition: {
      type: 'number',
      default: 3,
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
      default: 2,
      min: 0,
      max: 4,
      step: 0.05,
      label: 'max blur (% of height)',
    },
    bloom: { type: 'number', default: 0.5, min: 0, max: 2, step: 0.01 },
  },
  presets: {
    'on a schedule': {},
    'slow pull': { duration: 3, hold: 5 },
    'snap focus': { duration: 0.25, hold: 1.5 },
    'scroll story': { drive: 'scroll' },
    'click to focus': { drive: 'click' },
    'reduced motion': { reducedMotion: true },
  },
  inspect: {
    views: Object.keys(LENS_VIEWS),
    stages: ['rack focus', 'depth of field', 'lantern glow'],
  },

  async create({ device, format, hdr, canvas, params, profiler, inspect = defaultInspect() }) {
    const source = village as unknown as SceneSource;
    const scene = parseScene({
      ...source,
      sprites: [...(source.sprites ?? []), { art: 'traveller', at: [12.8, 2.6], flipX: true }],
    });
    // Each subject's middle: its feet on the ground, half its height (texels at 16 a unit) up.
    const points = SUBJECTS.map(
      ({ at, height }) =>
        [at[0], scene.heightAt(at[0], at[1]) + height / 32, at[1]] as [number, number, number],
    );

    const tail = createHdrTail(device, { format, hdr, label: 'rack-focus' });
    const stage = createDioramaStage(device, {
      scene,
      art: await loadSceneArt(scene, VILLAGE_ART),
      colorFormat: tail.scene.format,
      label: 'rack-focus',
    });
    const sharp = createRenderTarget(device, {
      label: 'rack-focus sharp',
      format: tail.scene.format,
      width: 1,
      height: 1,
    });
    const lens = createTiltShift(device, { format: tail.scene.format, label: 'rack-focus' });
    const rack = createRackFocus({ duration: params.duration });
    const pointer = trackPointer(canvas);

    let width = 1;
    let height = 1;
    let progress = 0;
    let clicked = 0;
    let wasDown = false;
    let subject = 0;
    const onWheel = (event: WheelEvent) => {
      if (params.drive !== 'scroll') return;
      event.preventDefault();
      progress = Math.min(Math.max(progress + event.deltaY / WHEEL_PER_LIST, 0), 1);
    };
    const onScroll = () => {
      if (params.drive !== 'scroll') return;
      progress = scrollProgress(canvas.getBoundingClientRect(), window.innerHeight);
    };
    canvas.addEventListener('wheel', onWheel as EventListener, { passive: false });
    const page = typeof window === 'undefined' ? undefined : window;
    page?.addEventListener('scroll', onScroll, { passive: true });

    return {
      resize(nextWidth, nextHeight) {
        tail.resize(nextWidth, nextHeight);
        stage.resize(nextWidth, nextHeight);
        sharp.resize(nextWidth, nextHeight);
        lens.resize(nextWidth, nextHeight);
        width = nextWidth;
        height = nextHeight;
      },
      frame(time, encoder, target) {
        const aspect = width / height;
        const fit = FRAME_WIDTH / (2 * Math.tan((scene.camera.fov * Math.PI) / 360) * aspect);
        const distance = Math.max(scene.camera.distance, fit);
        const camera = poseCamera({ ...scene.camera, distance }, aspect, 'perspective');
        const reduced = params.reducedMotion || prefersReducedMotion();

        // A press over a character focuses on it (the click drive's only input).
        const down = pointer.state.down && pointer.state.inside;
        if (down && !wasDown) {
          const picked = pickSubject(camera, points, pointer.state, [width, height], height * 0.12);
          if (picked !== undefined) clicked = picked;
        }
        wasDown = down;

        // Reduced motion turns off the focus that animates by itself; scrolling and clicking still
        // move it, but in one jump.
        if (params.drive === 'time') {
          subject = reduced ? 0 : scheduledSubject(time.time, SUBJECTS.length, params.hold);
        } else if (params.drive === 'scroll') {
          subject = scrolledSubject(progress, SUBJECTS.length);
        } else {
          subject = clicked;
        }
        rack.duration = params.duration;
        rack.rackTo(viewDistance(camera, points[subject]!), subject);
        const racked = rack.update(time.delta, reduced);
        const focusDistance = inspect.off.has('rack focus') ? distance + params.focus : racked;

        const view = LENS_VIEWS[inspect.view];
        const lensOn = view !== undefined || !inspect.off.has('depth of field');
        stage.encode(encoder, {
          camera,
          time: time.time,
          target: lensOn ? sharp.view : tail.scene.view,
          profiler,
          settings: { glow: inspect.off.has('lantern glow') ? 0 : 1, clear: [0.05, 0.06, 0.1] },
        });
        if (lensOn) {
          lens.encode(
            encoder,
            { color: sharp.view, depth: stage.depth, projection: camera.projection },
            tail.scene.view,
            {
              method: 'depth',
              focusDistance,
              focusBand: params.focusBand,
              nearTransition: params.nearTransition,
              farTransition: params.farTransition,
              maxBlur: params.maxBlur / 100,
              line: 0.5,
              lineBand: 0.1,
              lineTransition: 0.3,
              view: view ?? 'final',
            },
            profiler,
          );
        }
        const bloom = view === undefined ? params.bloom : 0;
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
          subject: SUBJECTS[subject]!.name,
          focus: rack.distance.toFixed(1),
          racking: rack.moving ? 'yes' : 'no',
        };
      },
      destroy() {
        canvas.removeEventListener('wheel', onWheel as EventListener);
        page?.removeEventListener('scroll', onScroll);
        pointer.destroy();
        lens.destroy();
        sharp.destroy();
        stage.destroy();
        tail.destroy();
      },
    };
  },
});
