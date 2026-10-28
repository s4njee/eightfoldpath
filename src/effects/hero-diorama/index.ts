import { poseCamera, scrollProgress } from '../../gpu/diorama/rig.ts';
import { createDioramaStage, loadSceneArt } from '../../gpu/diorama/stage.ts';
import { createTiltShift, viewDistance, type TiltShiftMethod } from '../../gpu/lens/tilt-shift.ts';
import {
  areaAt,
  createGradeLuts,
  createPostFxTail,
  FINISH_PARAMS,
  PIXEL_TAIL_PARAMS,
} from '../../gpu/post-fx/index.ts';
import { AREA_LOOKS, VILLAGE_AREAS } from '../colour-grading/looks.ts';
import { createRenderTarget } from '../../gpu/targets.ts';
import { VILLAGE_ART, villageScene } from '../diorama/village.ts';
import { defaultInspect, defineEffect } from '../types.ts';
import { meta } from './meta.ts';
import { heroAt, tourProgress, type HeroSection } from './sections.ts';

/*
 * Story 9.1: the village behind a landing-page hero. The page is in sections; scrolling through
 * them moves the camera along a path through one pose per section (sections.ts) and racks the
 * tilt-shift lens from one section's subject to the next. On a real page the progress is how far
 * the hero has scrolled through the viewport (`scrollProgress`); the gallery's page does not
 * scroll, so the wheel over the canvas stands in, and by default the clock tours the sections.
 */

/** Height of a subject's focus point above its feet: about the middle of a character. */
const CHEST = 1.4;

function sectionsFor(feet: (art: string) => readonly [number, number, number]): HeroSection[] {
  const at = (art: string, lift = CHEST) => {
    const [x, y, z] = feet(art);
    return [x, y + lift, z] as const;
  };
  return [
    {
      name: 'the village',
      pose: { focus: [12, 2, 8.5], yaw: 0.18, pitch: 34, fov: 25, distance: 40 },
      subject: at('traveller'),
    },
    {
      name: 'the square',
      pose: { focus: [9, 2.6, 9.7], yaw: -0.38, pitch: 27, fov: 25, distance: 24 },
      subject: at('mage'),
    },
    {
      name: 'the guard',
      pose: { focus: [15, 2.8, 10.4], yaw: 0.55, pitch: 29, fov: 25, distance: 21 },
      subject: at('knight', 1.8),
    },
    {
      name: 'the road on',
      pose: { focus: [11, 4.2, 3.8], yaw: 0.2, pitch: 40, fov: 25, distance: 25 },
      subject: [11, 4.4, 3.6],
    },
  ];
}

/** Wheel pixels for the whole page, when the wheel stands in for scrolling. */
const WHEEL_PER_PAGE = 2400;

export const effect = defineEffect({
  meta,
  params: {
    drive: { type: 'select', default: 'time', options: ['time', 'scroll'], label: 'driven by' },
    hold: { type: 'number', default: 4, min: 0, max: 12, step: 0.5, label: 'hold (seconds)' },
    travel: { type: 'number', default: 3, min: 0.5, max: 10, step: 0.5, label: 'travel (seconds)' },
    rack: {
      type: 'number',
      default: 0.35,
      min: 0,
      max: 1,
      step: 0.01,
      label: 'rack (share of the way)',
    },
    lens: { type: 'select', default: 'depth', options: ['depth', 'screen', 'off'] },
    focusBand: { type: 'number', default: 3, min: 0, max: 12, step: 0.1, label: 'focus band' },
    maxBlur: {
      type: 'number',
      default: 1.6,
      min: 0,
      max: 4,
      step: 0.05,
      label: 'max blur (% of height)',
    },
    grade: { type: 'number', default: 1, min: 0, max: 1, step: 0.01, label: 'area grade' },
    ...PIXEL_TAIL_PARAMS,
    ...FINISH_PARAMS,
  },
  presets: {
    tour: {},
    'scroll story': { drive: 'scroll' },
    'snap focus': { rack: 0 },
    'screen lens': { lens: 'screen' },
    'no lens': { lens: 'off' },
  },
  inspect: {
    views: ['circle of confusion'],
    stages: ['depth of field', 'shadows', 'bloom', 'grade', 'finishing'],
  },

  async create({ device, format, hdr, canvas, params, profiler, inspect = defaultInspect() }) {
    const scene = villageScene();
    const tail = createPostFxTail(device, { format, hdr, label: 'hero-diorama' });
    // The grade follows the camera's focus from area to area (story 5.7), crossfading as it goes.
    const grades = createGradeLuts(device, { label: 'hero-diorama' });
    let area: string | undefined;
    const stage = createDioramaStage(device, {
      scene,
      art: await loadSceneArt(scene, VILLAGE_ART),
      colorFormat: tail.scene.format,
      label: 'hero-diorama',
    });
    const sharp = createRenderTarget(device, {
      label: 'hero-diorama sharp',
      format: tail.scene.format,
      width: 1,
      height: 1,
    });
    const lens = createTiltShift(device, { format: tail.scene.format, label: 'hero-diorama' });
    const sections = sectionsFor((art) => {
      const sprite = scene.sprites.find((s) => s.art === art);
      if (!sprite) throw new Error(`The village has no ${art}`);
      return sprite.position;
    });

    let aspect = 1;
    let clock = 0;
    let progress = 0;
    let frame = heroAt(sections, 0, params.rack);
    const onWheel = (event: WheelEvent) => {
      if (params.drive !== 'scroll') return;
      event.preventDefault();
      progress = Math.min(Math.max(progress + event.deltaY / WHEEL_PER_PAGE, 0), 1);
    };
    const onScroll = () => {
      if (params.drive === 'scroll') {
        progress = scrollProgress(canvas.getBoundingClientRect(), window.innerHeight);
      }
    };
    canvas.addEventListener('wheel', onWheel as EventListener, { passive: false });
    const page = typeof window === 'undefined' ? undefined : window;
    page?.addEventListener('scroll', onScroll, { passive: true });

    return {
      resize(width, height) {
        tail.resize(width, height);
        stage.resize(width, height);
        sharp.resize(width, height);
        lens.resize(width, height);
        aspect = width / height;
      },
      frame(time, encoder, target) {
        clock += time.delta;
        if (params.drive === 'time') {
          progress = tourProgress(clock, sections.length, params.hold, params.travel);
        }
        frame = heroAt(sections, progress, params.rack);
        // A hero is wide; on a narrow canvas back off so the subject keeps its surroundings.
        const pose = { ...frame.pose, distance: frame.pose.distance * Math.max(1, 1.5 / aspect) };
        const camera = poseCamera(pose, aspect, 'perspective');
        area = areaAt(VILLAGE_AREAS, pose.focus[0], pose.focus[2], area);
        const graded = !inspect.off.has('grade') && params.grade > 0;
        grades.show(graded ? area : '-', graded ? [AREA_LOOKS[area] ?? {}] : [], 1.5);
        grades.update(time.delta);
        const near = viewDistance(camera, sections[frame.from]!.subject);
        const far = viewDistance(camera, sections[frame.to]!.subject);
        const focusDistance = near + (far - near) * frame.rack;

        const cocView = inspect.view === 'circle of confusion';
        const lensOn = cocView || (params.lens !== 'off' && !inspect.off.has('depth of field'));
        stage.encode(encoder, {
          camera,
          time: time.time,
          target: lensOn ? sharp.view : tail.scene.view,
          profiler,
          settings: { shadows: !inspect.off.has('shadows'), clear: [0.05, 0.06, 0.1] },
        });
        if (lensOn) {
          lens.encode(
            encoder,
            { color: sharp.view, depth: stage.depth, projection: camera.projection },
            tail.scene.view,
            {
              method: (params.lens === 'screen' ? 'screen' : 'depth') as TiltShiftMethod,
              focusDistance,
              focusBand: params.focusBand,
              // The transitions scale with the distance, so a close shot is as shallow as a wide one.
              nearTransition: Math.max(pose.distance * 0.12, 1),
              farTransition: Math.max(pose.distance * 0.15, 1),
              maxBlur: params.maxBlur / 100,
              line: 0.55,
              lineBand: 0.1,
              lineTransition: 0.35,
              view: cocView ? 'coc' : 'final',
            },
            profiler,
          );
        }
        const bloom = cocView || inspect.off.has('bloom') ? 0 : params.bloom;
        const finishing = !cocView && !inspect.off.has('finishing');
        tail.encode(encoder, target, time, { ...params, bloom }, profiler, {
          output: { tonemap: 'none' },
          grade: cocView ? undefined : grades.input,
          finish: {
            gradeStrength: params.grade,
            vignette: finishing ? params.vignette : 0,
            grain: finishing ? params.grain : 0,
            aberration: finishing ? params.aberration : 0,
          },
        });
      },
      stats() {
        return {
          section: sections[frame.section]!.name,
          area: area ?? '–',
          progress: progress.toFixed(2),
        };
      },
      destroy() {
        canvas.removeEventListener('wheel', onWheel as EventListener);
        page?.removeEventListener('scroll', onScroll);
        grades.destroy();
        lens.destroy();
        sharp.destroy();
        stage.destroy();
        tail.destroy();
      },
    };
  },
});
