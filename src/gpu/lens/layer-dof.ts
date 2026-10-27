/*
 * Depth of field for flat layers (story 9.4).
 *
 *   const blur = createLayerDof(device, { view, width, height }, { wrap: true });
 *   ...each frame, before drawing:
 *   blur.update(encoder, sigma, profiler);   // re-blurs only when sigma changed
 *   ...sample blur.view (premultiplied linear colour) with a linear sampler, uv = texel / size
 *
 * A layer that is flat and faces the camera has the same circle of confusion at every pixel, so
 * its blur does not have to be gathered per pixel per frame the way a depth-buffer depth of field
 * is (story 5.1). It is blurred once, into a texture `supersample` times the art's resolution, and
 * redone only when the focus or the aperture moves; drawing it then costs one bilinear sample.
 * layer-dof.wgsl has the kernel: each source texel is weighted by the Gaussian's integral over its
 * extent, so the passes loop over art texels, not output pixels.
 */
import { createFullscreenPipeline, renderFullscreen } from '../fullscreen.ts';
import { perDevice } from '../passes/common.ts';
import type { PassProfiler } from '../profiler.ts';
import { withChunks } from '../shader.ts';
import { createUniformBuffer, defineUniformStruct } from '../uniforms.ts';
import shader from './layer-dof.wgsl';

/** Premultiplied linear colour, filtered as linear by the sampler; eight bits are enough after sRGB encoding. */
export const LAYER_DOF_FORMAT: GPUTextureFormat = 'rgba8unorm-srgb';
const ROWS_FORMAT: GPUTextureFormat = 'rgba16float';

/** Output pixels per art texel. Four keeps a blur of a quarter texel visible at 20 px a texel. */
export const LAYER_DOF_SUPERSAMPLE = 4;

/** Caps the loop (in art texels each side) so a stray value cannot hang the GPU. */
export const MAX_LAYER_SIGMA = 10;

const LayerDofParams = defineUniformStruct('LayerDofParams', {
  size: 'vec2f',
  sigma: 'f32',
  taps: 'f32',
  supersample: 'f32',
  wrap_x: 'f32',
});

/** Art texels each side of the centre the kernel reads for `sigma`: three sigma, and at least one. */
export function layerDofTaps(sigma: number): number {
  return Math.ceil(3 * Math.min(Math.max(sigma, 0), MAX_LAYER_SIGMA)) + 1;
}

export interface LayerDofSource {
  /** A `2d-array` view of the art; layer 0 is read. sRGB-encoded, straight alpha. */
  view: GPUTextureView;
  width: number;
  height: number;
}

export interface LayerDofOptions {
  /** Wrap horizontally, for a layer that tiles (default); otherwise clamp. Rows always clamp. */
  wrap?: boolean;
  supersample?: number;
  label?: string;
}

export interface LayerDof {
  readonly texture: GPUTexture;
  /** Premultiplied linear colour, `supersample` times the art's size. Fixed for the blur's life. */
  readonly view: GPUTextureView;
  readonly width: number;
  readonly height: number;
  /** The sigma last blurred with, in art texels; NaN before the first `update`. */
  readonly sigma: number;
  /**
   * Encodes the two blur passes if `sigma` (in art texels, clamped to MAX_LAYER_SIGMA) differs
   * from the last by more than `tolerance`. Returns whether it did.
   */
  update(
    encoder: GPUCommandEncoder,
    sigma: number,
    profiler?: PassProfiler,
    tolerance?: number,
  ): boolean;
  destroy(): void;
}

const pipelinesFor = perDevice((device) => {
  const source = withChunks(shader, { 'layer_dof_params.wgsl': LayerDofParams.wgsl });
  return {
    horizontal: createFullscreenPipeline(device, {
      label: 'layer dof horizontal',
      fragment: source,
      entryPoint: 'fs_h',
      format: ROWS_FORMAT,
    }),
    vertical: createFullscreenPipeline(device, {
      label: 'layer dof vertical',
      fragment: source,
      entryPoint: 'fs_v',
      format: LAYER_DOF_FORMAT,
    }),
  };
});

export function createLayerDof(
  device: GPUDevice,
  source: LayerDofSource,
  options: LayerDofOptions = {},
): LayerDof {
  const label = options.label ?? 'layer dof';
  const supersample = Math.max(1, Math.round(options.supersample ?? LAYER_DOF_SUPERSAMPLE));
  const { horizontal, vertical } = pipelinesFor(device);
  const width = source.width * supersample;
  const height = source.height * supersample;
  const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
  const rows = device.createTexture({
    label: `${label} rows`,
    size: [width, source.height],
    format: ROWS_FORMAT,
    usage,
  });
  const output = device.createTexture({
    label,
    size: [width, height],
    format: LAYER_DOF_FORMAT,
    // Copy source too, so the result can be read back and checked.
    usage: usage | GPUTextureUsage.COPY_SRC,
  });
  const rowsView = rows.createView();
  const view = output.createView();
  const uniforms = createUniformBuffer(device, LayerDofParams, `${label} params`);
  uniforms.set({
    size: [source.width, source.height],
    supersample,
    wrap_x: options.wrap === false ? 0 : 1,
  });
  const horizontalGroup = device.createBindGroup({
    label: `${label} horizontal`,
    layout: horizontal.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniforms.buffer } },
      { binding: 1, resource: source.view },
    ],
  });
  const verticalGroup = device.createBindGroup({
    label: `${label} vertical`,
    layout: vertical.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniforms.buffer } },
      { binding: 2, resource: rowsView },
    ],
  });

  let sigma = Number.NaN;
  return {
    texture: output,
    view,
    width,
    height,
    get sigma() {
      return sigma;
    },
    update(encoder, next, profiler, tolerance = 0.01) {
      const clamped = Math.min(Math.max(next, 0), MAX_LAYER_SIGMA);
      if (Math.abs(clamped - sigma) <= tolerance) return false;
      sigma = clamped;
      // One buffer for both passes is fine: they run with the same parameters. Two updates of
      // one blur before a submit would both see the last sigma, which is the one wanted anyway.
      uniforms.set({ sigma, taps: layerDofTaps(sigma) });
      uniforms.upload();
      renderFullscreen(encoder, rowsView, horizontal, [horizontalGroup], {
        label: `${label} horizontal`,
        timestampWrites: profiler?.pass('dof'),
      });
      renderFullscreen(encoder, view, vertical, [verticalGroup], {
        label: `${label} vertical`,
        timestampWrites: profiler?.pass('dof'),
      });
      return true;
    },
    destroy() {
      rows.destroy();
      output.destroy();
      uniforms.destroy();
    },
  };
}
