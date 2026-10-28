/*
 * The grade and finishing pass (stories 5.7 and 5.8): a 3D lookup table, chromatic aberration at
 * the edges, a vignette and film grain, in one fullscreen pass after the output pass.
 *
 *   const finishing = createFinishingPass(device, { format });
 *   frame:  output.encode(encoder, display.view, scene, glow, { ...output, dither: 0 });
 *           finishing.encode(encoder, target, display.view, [w, h], { grade: luts.input, ...FINISH_DEFAULTS });
 *
 * The output pass does exposure, tonemap and sRGB encoding as before, into an rgba16float target
 * instead of the canvas, with its dither off; this pass reads that and writes the canvas, dither
 * included. `createPostFxTail` (tail.ts) wires the two up and skips this pass when nothing in it
 * is on. Upstream, the same work would fold into the output pass itself and save the target.
 */
import { createFullscreenPipeline, renderFullscreen } from '../fullscreen.ts';
import { linearSampler, perDevice } from '../passes/common.ts';
import { withChunks } from '../shader.ts';
import { createUniformBuffer, defineUniformStruct } from '../uniforms.ts';
import type { ParamSchema } from '../../effects/types.ts';
import { createGradeLutTexture, GRADE_LUT_SIZE, type GradeInput, writeGradeLut } from './grade.ts';
import shader from './finishing.wgsl';

const FinishParams = defineUniformStruct('FinishParams', {
  resolution: 'vec2f',
  aspect: 'f32',
  view: 'u32',
  grade_on: 'f32',
  grade_mix: 'f32',
  grade_strength: 'f32',
  lut_size: 'f32',
  vignette: 'f32',
  vignette_radius: 'f32',
  vignette_softness: 'f32',
  aberration: 'f32',
  grain: 'f32',
  grain_size: 'f32',
  frame: 'f32',
  dither_lsb: 'f32',
  opaque: 'f32',
});

/** Inspector views the pass can draw instead of the picture. */
export const FINISH_VIEWS = ['vignette', 'grain', 'aberration', 'grade table'] as const;
export type FinishView = 'final' | (typeof FINISH_VIEWS)[number];
const VIEW_ID: Record<FinishView, number> = {
  final: 0,
  vignette: 1,
  grain: 2,
  aberration: 3,
  'grade table': 4,
};

/** The height the pixel amounts are given at; they scale with the canvas so the look holds. */
export const FINISH_REFERENCE_HEIGHT = 1080;

export interface FinishSettings {
  /** The table(s) to grade with; leave out for no grade. */
  grade?: GradeInput;
  /** 0..1: how much of the grade is applied. Default 1. */
  gradeStrength?: number;
  /** 0..1: how much darker the corners are, in linear light. 0 is off. */
  vignette?: number;
  /** Where the darkening starts, 0 (centre) to 1 (corner). */
  vignetteRadius?: number;
  /** Over how much of the radius it ramps in. */
  vignetteSoftness?: number;
  /** Peak grain in 8-bit steps at mid grey (it fades to 0 in black and white). 0 is off. */
  grain?: number;
  /** Grain cell size in pixels at 1080p. */
  grainSize?: number;
  /** Red and blue shift at the corners, in pixels at 1080p. 0 is off. */
  aberration?: number;
  view?: FinishView;
  /** The frame counter, so the grain and dither move. */
  frame?: number;
  /** Dither strength in 8-bit steps, as the output pass takes it. Default 1. */
  dither?: number;
  /** The canvas is an HDR one: the dither is a 10-bit step instead. */
  hdr?: boolean;
  /** The output pass wrote opaque alpha. Default true. */
  opaque?: boolean;
}

/**
 * Subtle by default: a corner a fifth darker in linear light (about a tenth as displayed), grain
 * of three 8-bit steps at most, a pixel and a half of fringe in the corners at 1080p.
 */
export const FINISH_DEFAULTS = {
  vignette: 0.2,
  vignetteRadius: 0.45,
  vignetteSoftness: 0.75,
  grain: 3,
  grainSize: 1.5,
  aberration: 1.5,
} as const satisfies FinishSettings;

/** Spread into an effect's `params` to expose the finishing controls the same way everywhere. */
export const FINISH_PARAMS = {
  vignette: {
    type: 'number',
    default: FINISH_DEFAULTS.vignette,
    min: 0,
    max: 1,
    step: 0.01,
  },
  grain: {
    type: 'number',
    default: FINISH_DEFAULTS.grain,
    min: 0,
    max: 24,
    step: 0.1,
    label: 'grain (8-bit steps)',
  },
  aberration: {
    type: 'number',
    default: FINISH_DEFAULTS.aberration,
    min: 0,
    max: 12,
    step: 0.1,
    label: 'chromatic aberration (px at 1080p)',
  },
} as const satisfies ParamSchema;

/** Whether `settings` asks the pass to do anything the plain output pass would not. */
export function finishActive(settings: FinishSettings): boolean {
  return (
    settings.grade !== undefined ||
    (settings.vignette ?? 0) > 0 ||
    (settings.grain ?? 0) > 0 ||
    (settings.aberration ?? 0) > 0 ||
    (settings.view !== undefined && settings.view !== 'final')
  );
}

export interface FinishingPass {
  /**
   * Grades and finishes `source` (the output pass's picture) into `target`, both `size` pixels.
   * The parameters go out through `queue.writeBuffer`: one call per pass per submit.
   */
  encode(
    encoder: GPUCommandEncoder,
    target: GPUTextureView,
    source: GPUTextureView,
    size: readonly [number, number],
    settings: FinishSettings,
    timestampWrites?: GPURenderPassTimestampWrites,
  ): void;
  destroy(): void;
}

export interface FinishingPassOptions {
  format: GPUTextureFormat;
  label?: string;
}

// An identity table, bound when there is no grade so the layout never changes.
const identityFor = perDevice((device) => {
  const texture = createGradeLutTexture(device, 'grade identity', 2);
  writeGradeLut(
    device,
    texture,
    new Float32Array([
      0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1,
      1,
    ]),
  );
  return texture.createView();
});

export function createFinishingPass(
  device: GPUDevice,
  options: FinishingPassOptions,
): FinishingPass {
  const label = options.label ?? 'finishing';
  const uniforms = createUniformBuffer(device, FinishParams, `${label} params`);
  const pipeline = createFullscreenPipeline(device, {
    label,
    fragment: withChunks(shader, { 'finish-params.wgsl': FinishParams.wgsl }),
    format: options.format,
  });
  let group: GPUBindGroup | undefined;
  let key: readonly GPUTextureView[] = [];

  return {
    encode(encoder, target, source, size, settings, timestampWrites) {
      const identity = identityFor(device);
      const from = settings.grade?.from ?? identity;
      const to = settings.grade?.to ?? identity;
      if (!group || key[0] !== source || key[1] !== from || key[2] !== to) {
        group = device.createBindGroup({
          label,
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: source },
            { binding: 1, resource: linearSampler(device) },
            { binding: 2, resource: from },
            { binding: 3, resource: to },
            { binding: 4, resource: { buffer: uniforms.buffer } },
          ],
        });
        key = [source, from, to];
      }
      uniforms.set(finishUniforms(settings, size[0], size[1]));
      uniforms.upload();
      renderFullscreen(encoder, target, pipeline, [group], { label, timestampWrites });
    },
    destroy() {
      uniforms.destroy();
      group = undefined;
    },
  };
}

/** The uniform values for `settings` at a canvas of `width` x `height`. Exported for tests. */
export function finishUniforms(settings: FinishSettings, width: number, height: number) {
  const scale = height / FINISH_REFERENCE_HEIGHT;
  const grade = settings.grade;
  return {
    resolution: [width, height] as [number, number],
    aspect: width / Math.max(height, 1),
    view: VIEW_ID[settings.view ?? 'final'],
    grade_on: grade ? 1 : 0,
    grade_mix: grade ? Math.min(Math.max(grade.mix, 0), 1) : 0,
    grade_strength: Math.min(Math.max(settings.gradeStrength ?? 1, 0), 1),
    lut_size: grade ? (grade.size ?? GRADE_LUT_SIZE) : 2,
    vignette: Math.min(Math.max(settings.vignette ?? 0, 0), 1),
    vignette_radius: settings.vignetteRadius ?? FINISH_DEFAULTS.vignetteRadius,
    vignette_softness: Math.max(
      settings.vignetteSoftness ?? FINISH_DEFAULTS.vignetteSoftness,
      1e-3,
    ),
    aberration: Math.max(settings.aberration ?? 0, 0) * scale,
    grain: Math.max(settings.grain ?? 0, 0) / 255,
    grain_size: Math.max((settings.grainSize ?? FINISH_DEFAULTS.grainSize) * scale, 1),
    frame: (settings.frame ?? 0) % 1024,
    dither_lsb: ((settings.dither ?? 1) / 255) * (settings.hdr ? 0.25 : 1),
    opaque: settings.opaque === false ? 0 : 1,
  };
}
