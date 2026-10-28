/*
 * Bokeh highlights (story 5.2): the bright out-of-focus lights of the tilt-shift lens drawn as
 * shaped discs, the glittering lanterns of a blurred background.
 *
 *   const lens = createTiltShift(device, { label });
 *   const bokeh = createBokeh(device, { label });
 *   resize(w, h)  { lens.resize(w, h); bokeh.resize(w, h); }
 *   frame(...) {
 *     lens.encode(encoder, { color: sharp.view, depth, projection }, out,
 *       { ...lensSettings, bokehThreshold: 1.5 });          // holds the highlights back
 *     bokeh.encode(encoder, { color: sharp.view, prefiltered: lens.prefiltered }, out,
 *       { ...DEFAULT_BOKEH, threshold: 1.5 });              // and draws them, the same threshold
 *   }
 *
 * A pass after the lens rather than a stage inside it, fed by the lens's `prefiltered` target: the
 * lens's only change is to leave each blurred block's light above the threshold out of what it
 * gathers (`bokehThreshold`), and this module finds the same blocks, from the same 2 x 2 pixels of
 * the sharp image and the circle in `prefiltered`'s alpha, and draws exactly that light. So the
 * light is neither lost nor counted twice, the lens stays usable without it (the screen method, a
 * page that cannot afford it), and the bokeh can be switched off or reshaped without touching the
 * gather. A gather cannot draw a shaped disc cheaply (Moon Temple's hexagon method needs three
 * skewed passes for six blades), but a scatter of a few thousand small sprites can draw any shape.
 *
 * In bokeh.wgsl: a compute pass appends one record per bright blurred block, a one-invocation pass
 * writes the indirect draw's arguments, and one instanced quad per record is added onto the lens's
 * output as the aperture: a circle, a polygon of blades rounded by `curvature`, a bright or soft
 * rim, and a cat's eye toward the edges of the frame (bokeh-aperture.wgsl, after Moon Temple). The
 * shape is normalised by its area, so a disc's light does not change with its size or shape.
 *
 * At most `capacity` discs are drawn; past it the extra highlights' light is lost (the lens has
 * already held it back), which `readCount` shows. The village at night makes about 2 100 at
 * 1920 x 1080 and 560 at 960 x 540: one per 2 x 2 block of lit glass, not one per lamp.
 */
import type { PassProfiler } from '../profiler.ts';
import { createShader, withChunks } from '../shader.ts';
import type { RenderTarget } from '../targets.ts';
import { createUniformBuffer, defineUniformStruct } from '../uniforms.ts';
import shader from './bokeh.wgsl';

export interface BokehSettings {
  /**
   * Luminance above which a blurred pixel's light becomes a disc. Must be the lens's
   * `bokehThreshold`, or light is lost (lower here) or drawn twice (higher).
   */
  threshold: number;
  /** Aperture blades; below 3 is a circle. */
  blades: number;
  /** Rotation of the blades, degrees. */
  rotation: number;
  /** 0 straight blades, 1 a circle. */
  curvature: number;
  /** Bright rim (above 0, soap bubble) or soft edge (below 0), -0.5..1. */
  rim: number;
  /** Cat's eye toward the edges of the frame, 0..1. */
  catEye: number;
  /** Multiplies the discs' light. 1 conserves it. */
  intensity: number;
  /** Draw the discs alone, over black, instead of over the lens's output. */
  alone?: boolean;
}

/** Six slightly rounded blades, a faint bright rim and a mild cat's eye. */
export const DEFAULT_BOKEH: Readonly<BokehSettings> = {
  threshold: 1.5,
  blades: 6,
  rotation: 0,
  curvature: 0.1,
  rim: 0.25,
  catEye: 0.35,
  intensity: 1,
};

export interface BokehInput {
  /** The sharp HDR scene the lens read, full resolution. */
  color: GPUTextureView;
  /** The lens's `prefiltered` target, after its `depth` encode this frame. */
  prefiltered: RenderTarget;
}

export interface BokehOptions {
  /** Format of the output view. Default `rgba16float`, the HDR tail's scene. */
  format?: GPUTextureFormat;
  /** The most discs drawn in a frame. Default 16 384 (512 KiB of records). */
  capacity?: number;
  label?: string;
}

export interface Bokeh {
  /** Called before `encode` whenever the input size changes. */
  resize(width: number, height: number): void;
  /** Adds the discs onto `output` (or draws them alone), which is the input's size. */
  encode(
    encoder: GPUCommandEncoder,
    input: BokehInput,
    output: GPUTextureView,
    settings: BokehSettings,
    profiler?: PassProfiler,
  ): void;
  /**
   * After the frame's commands are submitted: how many blocks asked for a disc in the last
   * `encode`, and how many were drawn.
   */
  readCount(): Promise<{ wanted: number; drawn: number }>;
  destroy(): void;
}

// ---- CPU twins of bokeh-excess.wgsl and bokeh-aperture.wgsl, for tests and tools ---------------

const luminance = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;

/** The light above `threshold` in luminance, with the colour's hue: `bokeh_excess`'s twin. */
export function bokehExcess(
  color: readonly [number, number, number],
  threshold: number,
): [number, number, number] {
  const l = luminance(color);
  if (threshold <= 0 || l <= threshold) return [0, 0, 0];
  const share = (l - threshold) / l;
  return [color[0] * share, color[1] * share, color[2] * share];
}

/** Whether the lens holds a block's highlight back, by its signed circle: `bokeh_held`'s twin. */
export const bokehHeld = (coc: number) => Math.abs(coc) >= 1;

/** The share of a held-back highlight drawn as a disc: `bokeh_drawn`'s twin. */
export function bokehDrawn(coc: number): number {
  if (!bokehHeld(coc)) return 0;
  const t = Math.min(Math.max((Math.abs(coc) - 1) / 3, 0), 1);
  return t * t * (3 - 2 * t);
}

/** The aperture's radius at angle `theta` (radians), circumradius 1: `aperture_radius`'s twin. */
export function apertureRadius(
  theta: number,
  blades: number,
  rotation: number,
  curvature: number,
): number {
  if (blades < 3) return 1;
  const sector = (2 * Math.PI) / blades;
  const t = theta - rotation;
  const local = t - sector * Math.floor(t / sector) - 0.5 * sector;
  return (Math.cos(0.5 * sector) / Math.cos(local)) * (1 - curvature) + curvature;
}

/** Area of the aperture with circumradius 1: half the integral of r(theta)^2. */
export function apertureArea(blades: number, rotation: number, curvature: number): number {
  if (blades < 3) return Math.PI;
  const steps = 720;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const r = apertureRadius(((i + 0.5) / steps) * 2 * Math.PI, blades, rotation, curvature);
    sum += r * r;
  }
  return 0.5 * sum * ((2 * Math.PI) / steps);
}

// ---- the pass ---------------------------------------------------------------------------------

const BokehParams = defineUniformStruct('BokehParams', {
  out_size: 'vec2f',
  half_size: 'vec2f',
  threshold: 'f32',
  capacity: 'u32',
  blades: 'f32',
  rotation: 'f32',
  curvature: 'f32',
  unit_area: 'f32',
  rim: 'f32',
  cat_eye: 'f32',
  intensity: 'f32',
});

/** Bytes per record: (x, y, signed radius, unused) then (r, g, b, unused). */
const POINT_BYTES = 32;

export function createBokeh(device: GPUDevice, options: BokehOptions = {}): Bokeh {
  const label = options.label ? `${options.label} bokeh` : 'bokeh';
  const format = options.format ?? 'rgba16float';
  const capacity = Math.max(1, Math.round(options.capacity ?? 16384));
  const uniforms = createUniformBuffer(device, BokehParams, label);
  const module = createShader(
    device,
    withChunks(shader, { 'bokeh-params.wgsl': BokehParams.wgsl }),
  );
  const extract = device.createComputePipeline({
    label: `${label} extract`,
    layout: 'auto',
    compute: { module, entryPoint: 'extract' },
  });
  const finalise = device.createComputePipeline({
    label: `${label} finalise`,
    layout: 'auto',
    compute: { module, entryPoint: 'finalise' },
  });
  const add: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one', operation: 'add' };
  const sprites = device.createRenderPipeline({
    label: `${label} discs`,
    layout: 'auto',
    vertex: {
      module,
      entryPoint: 'sprite_vs',
      // The records the extract pass wrote, one per instance: no storage buffer in the vertex
      // stage, which compatibility mode may not offer.
      buffers: [
        {
          arrayStride: POINT_BYTES,
          stepMode: 'instance',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x4' },
            { shaderLocation: 1, offset: 16, format: 'float32x4' },
          ],
        },
      ],
    },
    fragment: {
      module,
      entryPoint: 'sprite_fs',
      targets: [{ format, blend: { color: add, alpha: add } }],
    },
  });

  const points = device.createBuffer({
    label: `${label} points`,
    size: capacity * POINT_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX,
  });
  const counter = device.createBuffer({
    label: `${label} counter`,
    size: 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  const args = device.createBuffer({
    label: `${label} draw args`,
    size: 16,
    usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE,
  });
  const finaliseGroup = device.createBindGroup({
    layout: finalise.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniforms.buffer } },
      { binding: 4, resource: { buffer: counter } },
      { binding: 5, resource: { buffer: args } },
    ],
  });

  let width = 1;
  let height = 1;
  // The shape's area is a sum over angles: only redone when the aperture changes.
  let shapeKey = '';
  let unitArea = Math.PI;

  return {
    resize(nextWidth, nextHeight) {
      width = Math.max(1, Math.round(nextWidth));
      height = Math.max(1, Math.round(nextHeight));
    },
    encode(encoder, input, output, settings, profiler) {
      const blades = Math.round(settings.blades) < 3 ? 0 : Math.round(settings.blades);
      const rotation = (settings.rotation * Math.PI) / 180;
      const curvature = Math.min(Math.max(settings.curvature, 0), 1);
      const key = `${blades}|${rotation}|${curvature}`;
      if (key !== shapeKey) {
        shapeKey = key;
        unitArea = apertureArea(blades, rotation, curvature);
      }
      uniforms.set({
        out_size: [width, height],
        half_size: [input.prefiltered.width, input.prefiltered.height],
        threshold: Math.max(settings.threshold, 0),
        capacity,
        blades,
        rotation,
        curvature,
        unit_area: unitArea,
        rim: settings.rim,
        cat_eye: Math.min(Math.max(settings.catEye, 0), 1),
        intensity: Math.max(settings.intensity, 0),
      });
      uniforms.upload();

      encoder.clearBuffer(counter);
      const compute = encoder.beginComputePass({
        label: `${label} extract`,
        timestampWrites: profiler?.pass('bokeh extract'),
      });
      compute.setPipeline(extract);
      compute.setBindGroup(
        0,
        device.createBindGroup({
          layout: extract.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: uniforms.buffer } },
            { binding: 1, resource: input.color },
            { binding: 2, resource: input.prefiltered.view },
            { binding: 3, resource: { buffer: points } },
            { binding: 4, resource: { buffer: counter } },
          ],
        }),
      );
      compute.dispatchWorkgroups(
        Math.ceil(input.prefiltered.width / 8),
        Math.ceil(input.prefiltered.height / 8),
      );
      compute.setPipeline(finalise);
      compute.setBindGroup(0, finaliseGroup);
      compute.dispatchWorkgroups(1);
      compute.end();

      const pass = encoder.beginRenderPass({
        label: `${label} discs`,
        colorAttachments: [
          {
            view: output,
            loadOp: settings.alone ? 'clear' : 'load',
            clearValue: [0, 0, 0, 1],
            storeOp: 'store',
          },
        ],
        timestampWrites: profiler?.pass('bokeh discs'),
      });
      pass.setPipeline(sprites);
      pass.setBindGroup(
        0,
        device.createBindGroup({
          layout: sprites.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: uniforms.buffer } },
            { binding: 2, resource: input.prefiltered.view },
          ],
        }),
      );
      pass.setVertexBuffer(0, points);
      pass.drawIndirect(args, 0);
      pass.end();
    },
    async readCount() {
      const read = device.createBuffer({
        size: 4,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const encoder = device.createCommandEncoder();
      encoder.copyBufferToBuffer(counter, 0, read, 0, 4);
      device.queue.submit([encoder.finish()]);
      await read.mapAsync(GPUMapMode.READ);
      const wanted = new Uint32Array(read.getMappedRange())[0]!;
      read.unmap();
      read.destroy();
      return { wanted, drawn: Math.min(wanted, capacity) };
    },
    destroy() {
      uniforms.destroy();
      points.destroy();
      counter.destroy();
      args.destroy();
    },
  };
}
