/*
 * Light shafts as a screen-space post-process (Mitchell, GPU Gems 3 ch. 13), at reduced
 * resolution. Story 5.5 compares this against marching a shadow map; this is the cheap half.
 *
 *   const shafts = createScreenShafts(device, { format: tail.scene.format });
 *   resize(w, h)  { shafts.resize(w, h); }
 *   frame:
 *     ...draw the occlusion mask into shafts.mask.view (SHAFTS_FORMAT): the light's radiance
 *        where it is seen, black wherever something is in front of it
 *     shafts.encode(encoder, { sun, reach, falloff }, profiler);
 *     shafts.composite(encoder, tail.scene.view, { intensity }, profiler);  // added to the HDR scene
 *
 * The mask, the radial blur and its intermediate are all `1 / divisor` of the canvas on each side
 * (a quarter by default, a sixteenth of the pixels): shafts are soft, so the bilinear upsample in
 * `composite` hides the resolution. The blur is two passes of `taps` samples that together cover
 * the ray with taps² (see shafts-screen.wgsl), which removes the stepped copies of occluder edges
 * a single pass of 2 × taps would leave.
 */
import { createFullscreenPipeline, renderFullscreen } from '../fullscreen.ts';
import { linearSampler } from '../passes/common.ts';
import type { PassProfiler } from '../profiler.ts';
import { withChunks } from '../shader.ts';
import { createRenderTarget, type RenderTarget } from '../targets.ts';
import { createUniformBuffer, defineUniformStruct } from '../uniforms.ts';
import shader from './shafts-screen.wgsl';

export const SHAFTS_FORMAT: GPUTextureFormat = 'rgba16float';
export const SHAFTS_DIVISOR = 4;
export const SHAFTS_TAPS = 12;

const ShaftParams = defineUniformStruct('ShaftParams', {
  sun: 'vec2f',
  reach: 'f32',
  taps: 'f32',
  decay: 'f32',
  gain: 'f32',
});

export interface ScreenShaftsOptions {
  /** Format of the target `composite` draws into: the HDR scene's. */
  format: GPUTextureFormat;
  /** Canvas pixels per mask pixel on each side. Default 4. */
  divisor?: number;
  /** Samples per pass; the ray gets taps². Default 12. */
  taps?: number;
  label?: string;
}

export interface ScreenShaftSettings {
  /** The light, in uv (0..1, top-left origin, like `FullscreenVarying.uv`). May be off screen. */
  sun: readonly [number, number];
  /** How much of the way to the light each pixel's ray reaches, 0..1. Mitchell's density. */
  reach: number;
  /** The weight of the last sample on a ray relative to the first, 0..1. Mitchell's decay. */
  falloff: number;
}

export interface ScreenShaftsComposite {
  /** Multiplies the shafts as they are added. */
  intensity: number;
  /** Show the mask instead of the shafts (for an inspector view). */
  source?: 'shafts' | 'mask';
  /** Clear the target first instead of adding to it, to show the shafts alone. */
  alone?: boolean;
}

export interface ScreenShafts {
  /** Draw the occlusion mask here each frame. Reallocated by `resize`; read it at encode time. */
  readonly mask: RenderTarget;
  /** The blurred shafts, the same size as the mask. */
  readonly result: RenderTarget;
  /** Takes the canvas size; the targets are `divisor` times smaller. */
  resize(width: number, height: number): void;
  encode(encoder: GPUCommandEncoder, settings: ScreenShaftSettings, profiler?: PassProfiler): void;
  composite(
    encoder: GPUCommandEncoder,
    target: GPUTextureView,
    settings: ScreenShaftsComposite,
    profiler?: PassProfiler,
  ): void;
  destroy(): void;
}

/** Per-sample weight that brings the last of `samples` samples down to `falloff` of the first. */
export function shaftDecay(falloff: number, samples: number): number {
  return Math.pow(Math.min(Math.max(falloff, 1e-4), 1), 1 / Math.max(samples - 1, 1));
}

export function createScreenShafts(device: GPUDevice, options: ScreenShaftsOptions): ScreenShafts {
  const label = options.label ?? 'shafts';
  const divisor = Math.max(1, options.divisor ?? SHAFTS_DIVISOR);
  const taps = Math.max(1, Math.round(options.taps ?? SHAFTS_TAPS));
  const source = withChunks(shader, { 'shaft_params.wgsl': ShaftParams.wgsl });
  const radial = createFullscreenPipeline(device, {
    label: `${label} radial`,
    fragment: source,
    entryPoint: 'fs_radial',
    format: SHAFTS_FORMAT,
  });
  const composite = createFullscreenPipeline(device, {
    label: `${label} composite`,
    fragment: source,
    entryPoint: 'fs_composite',
    format: options.format,
    blend: {
      color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
      alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
    },
  });
  const target = (name: string) =>
    createRenderTarget(device, {
      label: `${label} ${name}`,
      format: SHAFTS_FORMAT,
      width: 1,
      height: 1,
    });
  const mask = target('mask');
  const short = target('short');
  const result = target('result');
  // One buffer per pass: uniforms go out with writeBuffer, so passes in one submit cannot share.
  const shortParams = createUniformBuffer(device, ShaftParams, `${label} short params`);
  const longParams = createUniformBuffer(device, ShaftParams, `${label} long params`);
  const compositeParams = createUniformBuffer(device, ShaftParams, `${label} composite params`);
  const sampler = linearSampler(device);

  const groupFor = (pipeline: GPURenderPipeline, params: GPUBuffer, view: GPUTextureView) =>
    device.createBindGroup({
      label,
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: view },
        { binding: 2, resource: sampler },
      ],
    });
  let groups: Record<'short' | 'long' | 'shafts' | 'mask', GPUBindGroup>;
  const bind = () => {
    groups = {
      short: groupFor(radial, shortParams.buffer, mask.view),
      long: groupFor(radial, longParams.buffer, short.view),
      shafts: groupFor(composite, compositeParams.buffer, result.view),
      mask: groupFor(composite, compositeParams.buffer, mask.view),
    };
  };
  bind();

  return {
    mask,
    result,
    resize(width, height) {
      const w = Math.max(1, Math.ceil(width / divisor));
      const h = Math.max(1, Math.ceil(height / divisor));
      const changed = [mask, short, result].map((t) => t.resize(w, h));
      if (changed.some(Boolean)) bind();
    },
    encode(encoder, { sun, reach, falloff }, profiler) {
      const decay = shaftDecay(falloff, taps * taps);
      shortParams.set({ sun, reach: reach / taps, taps, decay });
      longParams.set({ sun, reach, taps, decay: Math.pow(decay, taps) });
      shortParams.upload();
      longParams.upload();
      renderFullscreen(encoder, short.view, radial, [groups.short], {
        label: `${label} short`,
        timestampWrites: profiler?.pass('shafts'),
      });
      renderFullscreen(encoder, result.view, radial, [groups.long], {
        label: `${label} long`,
        timestampWrites: profiler?.pass('shafts'),
      });
    },
    composite(encoder, view, { intensity, source = 'shafts', alone = false }, profiler) {
      compositeParams.set({ gain: intensity });
      compositeParams.upload();
      renderFullscreen(encoder, view, composite, [groups[source]], {
        label: `${label} composite`,
        load: !alone,
        timestampWrites: profiler?.pass('shafts composite'),
      });
    },
    destroy() {
      for (const t of [mask, short, result]) t.destroy();
      for (const u of [shortParams, longParams, compositeParams]) u.destroy();
    },
  };
}
