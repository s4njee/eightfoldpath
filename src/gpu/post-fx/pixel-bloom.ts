/*
 * Bloom for pixel scenes (story 5.4): the temple-core bloom chain with a source that thresholds
 * each texel before anything is averaged.
 *
 *   const bloom = createPixelBloom(device);
 *   resize(w, h)  { bloom.resize(w, h); }                      // the scene's size
 *   frame:        const glow = bloom.encode(encoder, scene.view, PIXEL_BLOOM, profiler);
 *                 output.encode(encoder, target, scene.view, glow, ...);
 *
 * `source: 'texel'` (the default) runs pixel-bloom.wgsl at half size, then a full-resolution chain
 * over that image with its own threshold off: the same level sizes and nearly the same work as the
 * stock half-resolution chain, plus one quarter-size pass. `source: 'average'` is the stock chain
 * (threshold after the 13-tap average), kept for the comparison in src/effects/pixel-bloom.
 *
 * Built here rather than in @mk7s/hologpu-temple-core because the core cannot be published from
 * this repo. It is general (nothing in it knows about pixel art), so it belongs upstream as a
 * `source` option on `createBloom`; see src/effects/pixel-bloom/notes.md.
 */
import {
  bloomLevelSizes,
  bloomLevelsForSize,
  createBloom,
  DEFAULT_BLOOM,
  type Bloom,
  type BloomSettings,
} from '../post/index.ts';
import { createFullscreenPipeline, renderFullscreen } from '../fullscreen.ts';
import type { PassProfiler } from '../profiler.ts';
import { withChunks } from '../shader.ts';
import { createRenderTarget, type RenderTarget } from '../targets.ts';
import { createUniformBuffer, defineUniformStruct } from '../uniforms.ts';
import shader from './pixel-bloom.wgsl';

const PixelBloomParams = defineUniformStruct('PixelBloomParams', {
  threshold: 'f32',
  knee: 'f32',
});

/** Where the threshold is applied: to each texel (`texel`) or to the chain's box averages. */
export const BLOOM_SOURCES = ['texel', 'average'] as const;
export type BloomSource = (typeof BLOOM_SOURCES)[number];

export interface PixelBloomSettings extends BloomSettings {
  source: BloomSource;
  /**
   * Levels relative to the automatic count when 0 or below (0 automatic, -1 one fewer), an
   * absolute count above 0. Relative counts keep the reach a fixed share of the picture.
   */
  levels: number;
}

/**
 * The tuning story 5.4 settled on for the village at dusk (experiments/pixel-bloom-study.test.ts):
 * threshold each texel, at 2 (above anything the sun or a lamp lights; the lamps' glass is 3 and
 * up) with a narrow knee, a tight radius and one level fewer than automatic. Firefly weighting is
 * off: with a per-texel threshold the only texels left are the emissive ones, and weighting them
 * by 1 / (1 + luma) is what starves a small lamp.
 */
export const PIXEL_BLOOM: Readonly<PixelBloomSettings> = {
  source: 'texel',
  intensity: 0.8,
  threshold: 2,
  knee: 0.25,
  radius: 0.45,
  levels: -1,
  fireflyFilter: false,
};

/** The stock tail's bloom (Fire Temple's defaults) in the same terms, for comparison. */
export const TAIL_BLOOM: Readonly<PixelBloomSettings> = { ...DEFAULT_BLOOM, source: 'average' };

export interface PixelBloom {
  /**
   * Records the bloom of `scene` and returns the finest level (glow times intensity), or
   * `undefined` when intensity is 0. Settings not given are `PIXEL_BLOOM`'s.
   */
  encode(
    encoder: GPUCommandEncoder,
    scene: GPUTextureView,
    settings?: Partial<PixelBloomSettings>,
    profiler?: PassProfiler,
  ): GPUTextureView | undefined;
  /**
   * Draws what the threshold lets through, at full size, into `target` (rgba16float), for an
   * inspector view.
   */
  encodeSource(
    encoder: GPUCommandEncoder,
    scene: GPUTextureView,
    target: GPUTextureView,
    settings?: Partial<PixelBloomSettings>,
  ): void;
  /** The scene's size. */
  resize(width: number, height: number): void;
  /** The level count `levels` stands for at the current size. */
  levelCount(levels?: number): number;
  destroy(): void;
}

export interface PixelBloomOptions {
  label?: string;
  /** Adds COPY_SRC to the chain's levels, for tests. */
  readable?: boolean;
}

export function createPixelBloom(device: GPUDevice, options: PixelBloomOptions = {}): PixelBloom {
  const label = options.label ?? 'pixel bloom';
  const source = withChunks(shader, { 'pixel-bloom-params.wgsl': PixelBloomParams.wgsl });
  const prefilter = createFullscreenPipeline(device, {
    label: `${label} source`,
    fragment: source,
    format: 'rgba16float',
  });
  const view = createFullscreenPipeline(device, {
    label: `${label} source view`,
    fragment: source,
    entryPoint: 'fs_view',
    format: 'rgba16float',
  });
  // One buffer per pipeline: both may run in one submit with different settings.
  const params = createUniformBuffer(device, PixelBloomParams, `${label} params`);
  const viewParams = createUniformBuffer(device, PixelBloomParams, `${label} view params`);
  const half: RenderTarget = createRenderTarget(device, {
    label: `${label} half`,
    format: 'rgba16float',
    width: 1,
    height: 1,
  });
  let size: [number, number] = [1, 1];
  // Each chain is built the first time it is asked for, so one that is never used costs nothing.
  const chains: Partial<Record<BloomSource, Bloom>> = {};
  const chainFor = (kind: BloomSource): Bloom => {
    let chain = chains[kind];
    if (!chain) {
      chain = createBloom(device, {
        label: `${label} ${kind}`,
        width: 1,
        height: 1,
        // The texel chain is fed an image that is already half size.
        halfResolution: kind === 'average',
        readable: options.readable,
      });
      chains[kind] = chain;
    }
    const [w, h] = kind === 'average' ? size : (bloomLevelSizes(...size, true)[0] ?? size);
    chain.resize(w, h);
    return chain;
  };
  // Bind groups per pipeline, rebuilt only when the scene view changes (on resize).
  const groups = new Map<GPURenderPipeline, { scene: GPUTextureView; group: GPUBindGroup }>();
  const groupFor = (pipeline: GPURenderPipeline, scene: GPUTextureView, buffer: GPUBuffer) => {
    const cached = groups.get(pipeline);
    if (cached?.scene === scene) return cached.group;
    const group = device.createBindGroup({
      label: `${label} source`,
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: scene },
        { binding: 1, resource: { buffer } },
      ],
    });
    groups.set(pipeline, { scene, group });
    return group;
  };
  const levelCount = (levels = PIXEL_BLOOM.levels) =>
    levels > 0 ? levels : Math.max(1, bloomLevelsForSize(...size, true) + levels);

  return {
    encode(encoder, scene, settings = {}, profiler) {
      const s = { ...PIXEL_BLOOM, ...settings };
      if (s.intensity <= 0) return undefined;
      const levels = levelCount(s.levels);
      if (s.source === 'average') {
        return chainFor('average').encode(encoder, scene, { ...s, levels }, profiler);
      }
      const chain = chainFor('texel');
      const [w, h] = bloomLevelSizes(...size, true)[0] ?? size;
      half.resize(w, h);
      params.set({ threshold: s.threshold, knee: s.knee });
      params.upload();
      const group = groupFor(prefilter, scene, params.buffer);
      renderFullscreen(encoder, half.view, prefilter, [group], {
        label: `${label} source`,
        timestampWrites: profiler?.pass('bloom-source'),
      });
      // The source is already thresholded: the chain's own threshold passes everything through.
      return chain.encode(encoder, half.view, { ...s, levels, threshold: 0, knee: 0 }, profiler);
    },
    encodeSource(encoder, scene, target, settings = {}) {
      const s = { ...PIXEL_BLOOM, ...settings };
      viewParams.set({ threshold: s.threshold, knee: s.knee });
      viewParams.upload();
      const group = groupFor(view, scene, viewParams.buffer);
      renderFullscreen(encoder, target, view, [group], { label: `${label} source view` });
    },
    resize(width, height) {
      size = [Math.max(1, Math.round(width)), Math.max(1, Math.round(height))];
    },
    levelCount,
    destroy() {
      for (const chain of Object.values(chains)) chain.destroy();
      groups.clear();
      half.destroy();
      params.destroy();
      viewParams.destroy();
    },
  };
}
