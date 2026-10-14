/*
 * A depth shadow map for sprite shadows (story 3.4).
 *
 *   const shadow = createShadowMap(device, { size: 2048 });
 *   const pass = encoder.beginRenderPass(shadow.pass());
 *   batch.drawDepth(pass, lightView, { depthFormat: shadow.format });
 *   pass.end();
 *   ...the receiver binds `shadow.view` with `shadow.linear` and calls shadow_pcf (shadow-pcf.wgsl).
 *
 * `depth32float` because it is core, can be read through a comparison sampler with linear
 * filtering (hardware 2×2 PCF with no optional feature) and can be copied; docs/support-matrix.md
 * section 5. The light's camera is `orthographicCamera` from src/gpu/sprites/camera.ts.
 */
import { mat4, vec3, type Mat4 } from 'wgpu-matrix';
import { createShader } from '../shader.ts';
import debugShader from '../../wgsl/shadow-debug.wgsl';
import pcf from '../../wgsl/shadow-pcf.wgsl?raw';

/** shadow-pcf.wgsl as text, for pasting into a sprite batcher's shade chunk. */
export const SHADOW_PCF_WGSL = pcf;

export interface ShadowMap {
  readonly format: GPUTextureFormat;
  readonly size: number;
  readonly texture: GPUTexture;
  readonly view: GPUTextureView;
  /** Comparison sampler (compare 'less') with linear filtering: hardware 2×2 PCF per tap. */
  readonly linear: GPUSampler;
  /** The same with nearest filtering: one hard yes-or-no per tap, for comparison. */
  readonly nearest: GPUSampler;
  /** A depth-only pass that clears the map and draws into it. */
  pass(timestampWrites?: GPURenderPassTimestampWrites): GPURenderPassDescriptor;
  /** Draws the map into a colour pass, for the layer inspector. */
  drawDebug(pass: GPURenderPassEncoder, colorFormat: GPUTextureFormat, aspect: number): void;
  destroy(): void;
}

export function createShadowMap(
  device: GPUDevice,
  options: { size?: number; label?: string } = {},
): ShadowMap {
  const label = options.label ?? 'shadow map';
  const size = options.size ?? 2048;
  const format: GPUTextureFormat = 'depth32float';
  const texture = device.createTexture({
    label,
    size: [size, size],
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const view = texture.createView();
  const sampler = (filter: GPUFilterMode) =>
    device.createSampler({
      label: `${label} ${filter}`,
      compare: 'less',
      magFilter: filter,
      minFilter: filter,
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

  // The inspector view is built on first use, so effects that never show it never compile it.
  let debug: { pipeline: GPURenderPipeline; group: GPUBindGroup; uniform: GPUBuffer } | undefined;
  const debugPipelines = new Map<GPUTextureFormat, GPURenderPipeline>();

  return {
    format,
    size,
    texture,
    view,
    linear: sampler('linear'),
    nearest: sampler('nearest'),
    pass(timestampWrites) {
      return {
        label: `${label} pass`,
        colorAttachments: [],
        depthStencilAttachment: {
          view,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
          depthClearValue: 1,
        },
        timestampWrites,
      };
    },
    drawDebug(pass, colorFormat, aspect) {
      let pipeline = debugPipelines.get(colorFormat);
      if (!pipeline) {
        const module = createShader(device, debugShader);
        pipeline = device.createRenderPipeline({
          label: `${label} debug`,
          layout: 'auto',
          vertex: { module, entryPoint: 'fullscreen_vs' },
          fragment: { module, entryPoint: 'fs', targets: [{ format: colorFormat }] },
        });
        debugPipelines.set(colorFormat, pipeline);
        debug = undefined;
      }
      if (!debug || debug.pipeline !== pipeline) {
        debug?.uniform.destroy();
        const uniform = device.createBuffer({
          label: `${label} debug aspect`,
          size: 16,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        debug = {
          pipeline,
          uniform,
          group: device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: view },
              { binding: 1, resource: { buffer: uniform } },
            ],
          }),
        };
      }
      device.queue.writeBuffer(debug.uniform, 0, new Float32Array([aspect, 0, 0, 0]));
      pass.setPipeline(debug.pipeline);
      pass.setBindGroup(0, debug.group);
      pass.draw(3);
    },
    destroy() {
      texture.destroy();
      debug?.uniform.destroy();
    },
  };
}

/**
 * Flattens geometry onto the plane y = `height` along `direction` (the way the light travels, so
 * its y is negative): the classic planar projected shadow. Multiply a camera's view-projection by
 * it to draw a silhouette where the light would throw it.
 */
export function planarProjection(direction: readonly [number, number, number], height = 0): Mat4 {
  const d = vec3.normalize(direction);
  // Grazing light would throw the shadow to infinity; keep it finite.
  const dy = Math.min(d[1]!, -0.05);
  const sx = -d[0]! / dy;
  const sz = -d[2]! / dy;
  // Column-major: x' = x + sx * y, y' = height, z' = z + sz * y. Points start on the ground
  // (y = 0) at a sprite's feet, so this projects from the ground up rather than from `height`.
  return mat4.create(1, 0, 0, 0, sx, 0, sz, 0, 0, 0, 1, 0, 0, height, 0, 1);
}
