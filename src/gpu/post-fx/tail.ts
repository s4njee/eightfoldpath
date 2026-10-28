/*
 * The HDR tail with stories 5.4, 5.7 and 5.8 in it: pixel bloom, then the output pass, then the
 * grade and finishing pass.
 *
 *   const tail = createPostFxTail(device, { format, hdr });
 *   resize(w, h)  { tail.resize(w, h); }
 *   frame(time, encoder, target) {
 *     ...draw linear radiance into tail.scene.view
 *     tail.encode(encoder, target, time, params, profiler, {
 *       grade: grades.input,                                  // from createGradeLuts (grade.ts)
 *       finish: { vignette: params.vignette, grain: params.grain, aberration: params.aberration },
 *     });
 *   }
 *
 * It takes the same values as `createHdrTail` (src/gpu/post/tail.ts), so an effect moves over by
 * changing the constructor; `PIXEL_TAIL_PARAMS` are `TAIL_PARAMS` with this tail's bloom defaults.
 * With no grade and nothing in `finish` switched on, the output pass draws straight into the canvas
 * and the tail costs what the stock one does, plus pixel bloom's quarter-size source pass.
 *
 * The colour pipeline order (plan.md): scene -> fog and shafts -> depth of field -> bloom ->
 * tonemap -> grade -> finishing -> sRGB. The grade sits after the tonemap rather than before it;
 * grade.ts gives the reasons.
 */
import type { FrameTime, ParamSchema } from '../../effects/types.ts';
import {
  createOutputPass,
  TAIL_PARAMS,
  tailSettings,
  type OutputSettings,
  type TailValues,
} from '../post/index.ts';
import type { PassProfiler } from '../profiler.ts';
import { createRenderTarget, type RenderTarget } from '../targets.ts';
import { createFinishingPass, finishActive, type FinishSettings } from './finishing.ts';
import type { GradeInput } from './grade.ts';
import { createPixelBloom, PIXEL_BLOOM, type PixelBloomSettings } from './pixel-bloom.ts';

/** `TAIL_PARAMS` with pixel bloom's defaults. */
export const PIXEL_TAIL_PARAMS = {
  ...TAIL_PARAMS,
  bloom: { ...TAIL_PARAMS.bloom, default: PIXEL_BLOOM.intensity },
  bloomThreshold: { ...TAIL_PARAMS.bloomThreshold, default: PIXEL_BLOOM.threshold },
  bloomRadius: { ...TAIL_PARAMS.bloomRadius, default: PIXEL_BLOOM.radius },
} as const satisfies ParamSchema;

export interface PostFxOverrides {
  /** Refines the bloom the values ask for (knee, levels, source, ...); `false` turns it off. */
  bloom?: Partial<PixelBloomSettings> | false;
  output?: OutputSettings;
  /** The grade tables. Leave out for no grade. */
  grade?: GradeInput;
  /** Vignette, grain, aberration and the rest; the grade, frame and HDR flag are filled in. */
  finish?: Omit<FinishSettings, 'grade' | 'frame' | 'hdr' | 'opaque'>;
}

export interface PostFxTailOptions {
  format: GPUTextureFormat;
  hdr?: boolean;
  label?: string;
}

export interface PostFxTail {
  /** Draw linear radiance here (rgba16float). Its `view` changes on resize. */
  readonly scene: RenderTarget;
  readonly bloom: ReturnType<typeof createPixelBloom>;
  resize(width: number, height: number): boolean;
  encode(
    encoder: GPUCommandEncoder,
    target: GPUTextureView,
    time: FrameTime,
    values: TailValues,
    profiler?: PassProfiler,
    overrides?: PostFxOverrides,
  ): void;
  destroy(): void;
}

export function createPostFxTail(device: GPUDevice, options: PostFxTailOptions): PostFxTail {
  const label = options.label ?? 'post-fx';
  const hdr = options.hdr === true;
  const target = (name: string) =>
    createRenderTarget(device, {
      label: `${label} ${name}`,
      format: 'rgba16float',
      width: 1,
      height: 1,
    });
  const scene = target('scene');
  // The tonemapped picture the finishing pass reads; allocated the first time it is needed.
  let display: RenderTarget | undefined;
  const bloom = createPixelBloom(device, { label: `${label} bloom` });
  const direct = createOutputPass(device, { format: options.format, label: `${label} output` });
  let staged: ReturnType<typeof createOutputPass> | undefined;
  const finishing = createFinishingPass(device, {
    format: options.format,
    label: `${label} finish`,
  });

  return {
    scene,
    bloom,
    resize(width, height) {
      bloom.resize(width, height);
      display?.resize(width, height);
      return scene.resize(width, height);
    },
    encode(encoder, canvas, time, values, profiler, overrides = {}) {
      const settings = tailSettings(values, time, hdr);
      const over = overrides.bloom;
      const glow =
        settings.bloom === false || over === false
          ? undefined
          : bloom.encode(encoder, scene.view, { ...settings.bloom, ...over }, profiler);
      const output: OutputSettings = { ...settings.output, ...overrides.output };
      const finish: FinishSettings = {
        ...overrides.finish,
        grade: overrides.grade,
        frame: time.frame,
        hdr,
        dither: output.dither,
        opaque: (output.alpha ?? 'opaque') === 'opaque',
      };
      if (!finishActive(finish)) {
        direct.encode(encoder, canvas, scene.view, glow, output, profiler?.pass('output'));
        return;
      }
      display ??= target('display');
      display.resize(scene.width, scene.height);
      staged ??= createOutputPass(device, { format: 'rgba16float', label: `${label} display` });
      staged.encode(
        encoder,
        display.view,
        scene.view,
        glow,
        { ...output, dither: 0 },
        profiler?.pass('output'),
      );
      finishing.encode(
        encoder,
        canvas,
        display.view,
        [scene.width, scene.height],
        finish,
        profiler?.pass('finish'),
      );
    },
    destroy() {
      bloom.destroy();
      direct.destroy();
      staged?.destroy();
      finishing.destroy();
      scene.destroy();
      display?.destroy();
    },
  };
}
