import { poseCamera } from '../../gpu/diorama/rig.ts';
import { createDioramaStage, loadSceneArt } from '../../gpu/diorama/stage.ts';
import {
  areaAt,
  createGradeLuts,
  createPostFxTail,
  PIXEL_TAIL_PARAMS,
  type GradeLook,
} from '../../gpu/post-fx/index.ts';
import { VILLAGE_ART, villageScene } from '../diorama/village.ts';
import { defaultInspect, defineEffect } from '../types.ts';
import {
  AREA_LOOKS,
  TIME_LIGHT,
  TIME_LOOKS,
  TIMES_OF_DAY,
  VILLAGE_AREAS,
  type TimeOfDay,
} from './looks.ts';
import { meta } from './meta.ts';

/*
 * Story 5.7 on the village: a look per time of day and one per area, baked into a 32³ table and
 * crossfaded whenever either changes (src/gpu/post-fx/grade.ts). The camera tours the three areas;
 * the area is the one under the camera's focus point, held until the focus is well into the next.
 * The time of day also moves the sun, eased over the same fade.
 */

const smoothstep = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The tour: the square, up the road, back through the square, down to the shore. */
const TOUR = ['the square', 'the road on', 'the square', 'the shore'];

type Light = (typeof TIME_LIGHT)[TimeOfDay];

export const effect = defineEffect({
  meta,
  params: {
    time: {
      type: 'select',
      default: 'dusk',
      options: [...TIMES_OF_DAY, 'cycle'],
      label: 'time of day',
    },
    cycle: {
      type: 'number',
      default: 8,
      min: 2,
      max: 30,
      step: 0.5,
      label: 'cycle (seconds each)',
    },
    area: {
      type: 'select',
      default: 'tour',
      options: ['tour', ...VILLAGE_AREAS.map((area) => area.name)],
      label: 'camera',
    },
    hold: { type: 'number', default: 4, min: 0, max: 12, step: 0.5, label: 'hold (seconds)' },
    travel: { type: 'number', default: 3, min: 0.5, max: 10, step: 0.5, label: 'travel (seconds)' },
    fade: { type: 'number', default: 1.5, min: 0, max: 6, step: 0.1, label: 'crossfade (seconds)' },
    strength: { type: 'number', default: 1, min: 0, max: 1, step: 0.01, label: 'grade strength' },
    distance: {
      type: 'number',
      default: 30,
      min: 16,
      max: 60,
      step: 0.5,
      label: 'camera distance',
    },
    ...PIXEL_TAIL_PARAMS,
  },
  presets: {
    tour: {},
    'day cycle': { time: 'cycle' },
    day: { time: 'day' },
    night: { time: 'night' },
    'the shore at dusk': { area: 'the shore' },
    'hard cuts': { fade: 0 },
    ungraded: { strength: 0 },
  },
  inspect: {
    views: ['grade table'],
    stages: ['time-of-day grade', 'area grade', 'time-of-day light'],
  },

  async create({ device, format, hdr, params, profiler, inspect = defaultInspect() }) {
    const scene = villageScene();
    const tail = createPostFxTail(device, { format, hdr, label: 'colour-grading' });
    const stage = createDioramaStage(device, {
      scene,
      art: await loadSceneArt(scene, VILLAGE_ART),
      colorFormat: tail.scene.format,
      label: 'colour-grading',
    });
    const grades = createGradeLuts(device, { label: 'colour-grading' });
    let aspect = 1;
    let clock = 0;
    let area = TOUR[0]!;
    let light: Light = { ...TIME_LIGHT.dusk };
    let lightFrom: Light = light;
    let lightTo: Light = light;
    let lightTime = '';
    let lightT = 1;
    let inspected = '';

    const focusAt = (t: number): readonly [number, number, number] => {
      const fixed = VILLAGE_AREAS.find((a) => a.name === params.area);
      if (fixed) return fixed.focus;
      const leg = params.hold + params.travel;
      const index = Math.floor(t / leg);
      const into = t - index * leg;
      const from = VILLAGE_AREAS.find((a) => a.name === TOUR[index % TOUR.length])!.focus;
      const to = VILLAGE_AREAS.find((a) => a.name === TOUR[(index + 1) % TOUR.length])!.focus;
      const s = smoothstep(Math.min(Math.max((into - params.hold) / params.travel, 0), 1));
      return [lerp(from[0], to[0], s), lerp(from[1], to[1], s), lerp(from[2], to[2], s)];
    };
    const timeAt = (t: number): TimeOfDay => {
      if (params.time !== 'cycle') {
        return (TIMES_OF_DAY as readonly string[]).includes(params.time)
          ? (params.time as TimeOfDay)
          : 'dusk';
      }
      return TIMES_OF_DAY[Math.floor(t / params.cycle) % TIMES_OF_DAY.length]!;
    };

    return {
      resize(width, height) {
        tail.resize(width, height);
        stage.resize(width, height);
        aspect = width / height;
      },
      frame(time, encoder, target) {
        clock += time.delta;
        const focus = focusAt(clock);
        area = areaAt(VILLAGE_AREAS, focus[0], focus[2], area);
        const timeOfDay = timeAt(clock);

        // The inspector cuts rather than fades, so switching a stage shows its effect at once.
        const offTime = inspect.off.has('time-of-day grade');
        const offArea = inspect.off.has('area grade');
        const offLight = inspect.off.has('time-of-day light');
        const switches = `${offTime}/${offArea}/${offLight}`;
        const cut = switches !== inspected;
        inspected = switches;
        const looks: GradeLook[] = [];
        if (!offTime) looks.push(TIME_LOOKS[timeOfDay]);
        if (!offArea) looks.push(AREA_LOOKS[area] ?? {});
        grades.show(
          `${offTime ? '-' : timeOfDay}/${offArea ? '-' : area}`,
          looks,
          cut ? 0 : params.fade,
        );
        grades.update(time.delta);

        const wanted = offLight ? 'day' : timeOfDay;
        if (wanted !== lightTime) {
          lightFrom = { ...light };
          lightTo = TIME_LIGHT[wanted];
          lightTime = wanted;
          lightT = cut || params.fade <= 0 ? 1 : 0;
        }
        lightT = params.fade > 0 ? Math.min(1, lightT + time.delta / params.fade) : 1;
        const k = smoothstep(lightT);
        light = {
          sunElevation: lerp(lightFrom.sunElevation, lightTo.sunElevation, k),
          sunAzimuth: lerp(lightFrom.sunAzimuth, lightTo.sunAzimuth, k),
          sunIntensity: lerp(lightFrom.sunIntensity, lightTo.sunIntensity, k),
          exposure: lerp(lightFrom.exposure, lightTo.exposure, k),
        };

        const camera = poseCamera(
          { ...scene.camera, focus, distance: params.distance },
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
        tail.encode(
          encoder,
          target,
          time,
          { ...params, exposure: params.exposure * light.exposure },
          profiler,
          {
            output: { tonemap: 'none' },
            grade: grades.input,
            finish: {
              gradeStrength: params.strength,
              view: inspect.view === 'grade table' ? 'grade table' : 'final',
            },
          },
        );
      },
      stats() {
        return { area, 'time of day': timeAt(clock), crossfade: grades.mix.toFixed(2) };
      },
      destroy() {
        grades.destroy();
        stage.destroy();
        tail.destroy();
      },
    };
  },
});
