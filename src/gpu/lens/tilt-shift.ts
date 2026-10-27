/*
 * The tilt-shift lens (story 5.1): depth of field that makes a diorama read as a miniature.
 *
 *   const lens = createTiltShift(device, { label: 'my effect' });
 *   resize(w, h)  { lens.resize(w, h); }
 *   frame(...) {
 *     ...draw the scene into an rgba16float colour target and a depth texture (MSAA or not)
 *     lens.encode(encoder, { color, depth, projection: camera.projection }, tail.scene.view,
 *       { ...DEFAULT_TILT_SHIFT, focusDistance: 24 }, profiler);
 *     tail.encode(...)   // bloom and tonemap after the lens, plan.md's colour pipeline
 *   }
 *
 * Two methods (see tilt-shift.wgsl):
 *
 * - `depth`: a half-resolution gather after Jimenez (2014), ported from Moon Temple. The circle of
 *   confusion comes from the depth buffer through a focus band: sharp within `focusBand / 2` of
 *   `focusDistance`, growing to `maxBlur` over `nearTransition` world units in front and
 *   `farTransition` behind (a game lens's focal region and transitions, not a thin lens). Near and far
 *   fields are gathered apart, so a blurred foreground spreads over a sharp edge and a blurred
 *   background never bleeds onto a sharp foreground. Reads multisampled depth with `textureLoad`,
 *   since WebGPU cannot resolve depth (docs/support-matrix.md).
 * - `screen`: no depth at all. The blur grows with distance from a horizontal line (`line`, a share
 *   of the height from the top), the tilt-shift photo filter, as a separable Gaussian at half
 *   resolution. The fallback for compat devices, flat layers and anything without a depth buffer.
 *
 * Everything in `TiltShiftSettings` is read at encode time, so focus can be animated (rack focus,
 * story 5.3) by changing it every frame. `prefiltered` holds the half-resolution colour with each
 * block's signed circle in alpha, which is where bright out-of-focus lights can be found later and
 * drawn as shaped discs (story 5.2).
 */
import type { Mat4 } from 'wgpu-matrix';
import { createFullscreenPipeline, renderFullscreen } from '../fullscreen.ts';
import type { PassProfiler } from '../profiler.ts';
import { withChunks } from '../shader.ts';
import { createRenderTarget, type RenderTarget } from '../targets.ts';
import { createUniformBuffer, defineUniformStruct } from '../uniforms.ts';
import shader from './tilt-shift.wgsl';

export const TILT_SHIFT_METHODS = ['depth', 'screen'] as const;
export type TiltShiftMethod = (typeof TILT_SHIFT_METHODS)[number];

/** What the lens writes: the picture, or one of the inspector's views of it. */
export const TILT_SHIFT_VIEWS = ['final', 'coc', 'near', 'far'] as const;
export type TiltShiftView = (typeof TILT_SHIFT_VIEWS)[number];

export interface TiltShiftSettings {
  method: TiltShiftMethod;
  /** depth: distance along the view axis, world units, at the middle of the sharp band. */
  focusDistance: number;
  /** depth: how deep the sharp band is, world units. */
  focusBand: number;
  /** depth: world units in front of the band over which the blur grows to `maxBlur`. */
  nearTransition: number;
  /** depth: world units behind the band over which the blur grows to `maxBlur`. */
  farTransition: number;
  /** The largest blur radius, as a share of the image height (0.015 is 16 pixels at 1080p). */
  maxBlur: number;
  /** screen: height of the sharp line, 0 at the top of the image to 1 at the bottom. */
  line: number;
  /** screen: half the height of the sharp band about the line, as a share of the image height. */
  lineBand: number;
  /** screen: how far beyond the band the blur takes to reach `maxBlur`, share of the height. */
  lineTransition: number;
  /** Default `final`. */
  view?: TiltShiftView;
}

/** A diorama seen from about 25 world units away, with the screen line through the middle. */
export const DEFAULT_TILT_SHIFT: Readonly<TiltShiftSettings> = {
  method: 'depth',
  focusDistance: 25,
  focusBand: 3,
  nearTransition: 6,
  farTransition: 14,
  maxBlur: 0.015,
  line: 0.5,
  lineBand: 0.06,
  lineTransition: 0.3,
};

export interface TiltShiftInput {
  /** The sharp HDR scene, full resolution (`rgba16float` or any float colour format). */
  color: GPUTextureView;
  /** The scene's depth buffer, sample count 1 or 4. Needed by `depth`; `screen` ignores it. */
  depth?: GPUTexture;
  /** The projection the depth was drawn with (`CameraState.projection`), to linearise it. */
  projection?: Mat4 | ArrayLike<number>;
}

export interface TiltShiftOptions {
  /** Format of the output view. Default `rgba16float`, the HDR tail's scene. */
  format?: GPUTextureFormat;
  label?: string;
}

export interface TiltShift {
  /**
   * Half-resolution colour with each block's signed circle of confusion in alpha (full-resolution
   * pixels, negative in front of focus), as of the last `depth` encode.
   */
  readonly prefiltered: RenderTarget;
  /** Called before `encode` whenever the input size changes. */
  resize(width: number, height: number): void;
  /** Writes the defocused image (or `settings.view`) to `output`, the input's size. */
  encode(
    encoder: GPUCommandEncoder,
    input: TiltShiftInput,
    output: GPUTextureView,
    settings: TiltShiftSettings,
    profiler?: PassProfiler,
  ): void;
  destroy(): void;
}

/** The gather's ceiling, full-resolution pixels: beyond it the 49-tap ring kernel grows too sparse. */
export const MAX_RADIUS = 48;
/**
 * The floor of the largest blur, pixels. Below a few pixels the half-resolution passes draw
 * nothing, so on a thumbnail-sized canvas a share of the height would make the lens vanish.
 */
export const MIN_RADIUS = 4;
/** Full-resolution pixels per tile side; must match `TILE` in tilt-shift.wgsl. */
const TILE = 16;

/** The largest blur radius in pixels for an image `height` pixels tall. */
export function maxRadiusPixels(settings: Pick<TiltShiftSettings, 'maxBlur'>, height: number) {
  if (settings.maxBlur <= 0) return 0;
  return Math.min(Math.max(settings.maxBlur * height, MIN_RADIUS), MAX_RADIUS);
}

/**
 * Signed circle of confusion, pixels, of a point `distance` world units along the view axis: the
 * TypeScript twin of `coc_from_distance` in tilt-shift.wgsl. Negative in front of focus.
 */
export function cocFromDistance(
  distance: number,
  settings: Pick<
    TiltShiftSettings,
    'focusDistance' | 'focusBand' | 'nearTransition' | 'farTransition' | 'maxBlur'
  >,
  height: number,
): number {
  const near = distance < settings.focusDistance;
  const off = Math.abs(distance - settings.focusDistance) - settings.focusBand / 2;
  const transition = near ? settings.nearTransition : settings.farTransition;
  const r = maxRadiusPixels(settings, height) * Math.min(Math.max(off / transition, 0), 1);
  return near ? -r : r;
}

/** The screen method's signed circle at row `y` (pixels from the top): `coc_from_row`'s twin. */
export function cocFromRow(
  y: number,
  settings: Pick<TiltShiftSettings, 'line' | 'lineBand' | 'lineTransition' | 'maxBlur'>,
  height: number,
): number {
  const v = y / height;
  const off = Math.abs(v - settings.line) - settings.lineBand;
  const r =
    maxRadiusPixels(settings, height) * Math.min(Math.max(off / settings.lineTransition, 0), 1);
  return v > settings.line ? -r : r;
}

/** Distance along the view axis of a world point, for focusing on an object (rack focus, 5.3). */
export function viewDistance(
  camera: { eye: readonly number[]; forward: readonly number[] },
  point: readonly number[],
): number {
  return [0, 1, 2].reduce((sum, i) => sum + (point[i]! - camera.eye[i]!) * camera.forward[i]!, 0);
}

const TiltShiftParams = defineUniformStruct('TiltShiftParams', {
  depth_to_distance: 'vec4f',
  out_size: 'vec2f',
  half_size: 'vec2f',
  focus: 'f32',
  band_half: 'f32',
  near_transition: 'f32',
  far_transition: 'f32',
  max_radius: 'f32',
  line: 'f32',
  line_band: 'f32',
  line_transition: 'f32',
  view: 'f32',
});

/** How the depth texture is declared and read, by sample count (`textureLoad`'s last argument is
 * the sample index for one and the mip level for the other, so the call is the same). */
const depthChunk = (multisampled: boolean) => `@group(1) @binding(1) var depth_tex: ${
  multisampled ? 'texture_depth_multisampled_2d' : 'texture_depth_2d'
};
fn load_depth(p: vec2i) -> f32 {
  return textureLoad(depth_tex, p, 0);
}
`;

export function createTiltShift(device: GPUDevice, options: TiltShiftOptions = {}): TiltShift {
  const label = options.label ? `${options.label} tilt-shift` : 'tilt-shift';
  const format = options.format ?? 'rgba16float';
  const uniforms = createUniformBuffer(device, TiltShiftParams, label);
  const sources = [false, true].map((multisampled) =>
    withChunks(shader, {
      'tilt-shift-params.wgsl': TiltShiftParams.wgsl,
      'tilt-shift-depth.wgsl': depthChunk(multisampled),
    }),
  );
  const pipelines = new Map<string, GPURenderPipeline>();
  /** Built on first use, so a page that only ever uses `screen` compiles none of the gather. */
  function pipeline(
    entryPoint: string,
    targets: GPUTextureFormat | GPUTextureFormat[],
    sampleCount = 1,
  ): GPURenderPipeline {
    const key = `${entryPoint}/${sampleCount}`;
    let found = pipelines.get(key);
    if (!found) {
      found = createFullscreenPipeline(device, {
        fragment: sources[sampleCount > 1 ? 1 : 0]!,
        entryPoint,
        format: targets,
        label: `${label} ${key}`,
      });
      pipelines.set(key, found);
    }
    return found;
  }
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const target = (name: string, targetFormat: GPUTextureFormat, usage?: GPUTextureUsageFlags) =>
    createRenderTarget(device, {
      label: `${label} ${name}`,
      format: targetFormat,
      width: 1,
      height: 1,
      usage,
    });
  // Targets are sized on first use by each method, so a method never used costs no memory.
  const prefiltered = target(
    'prefiltered',
    'rgba16float',
    GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
  );
  const spread = target('spread', 'rgba16float');
  const tileMax = target('tiles', 'r16float');
  const dilated = target('dilated', 'r16float');
  const far = target('far', 'rgba16float');
  const near = target('near', 'rgba16float');
  const screenDown = target('screen down', 'rgba16float');
  const screenH = target('screen h', 'rgba16float');
  const screenV = target('screen v', 'rgba16float');

  let width = 1;
  let height = 1;
  let halfWidth = 1;
  let halfHeight = 1;

  /** One uniform buffer, written once per encode: every pass reads the same values. */
  function groups(
    used: GPURenderPipeline,
    withSampler: boolean,
    inputs: Record<number, GPUTextureView>,
  ): GPUBindGroup[] {
    return [
      device.createBindGroup({
        layout: used.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniforms.buffer } },
          ...(withSampler ? [{ binding: 1, resource: sampler }] : []),
        ],
      }),
      device.createBindGroup({
        layout: used.getBindGroupLayout(1),
        entries: Object.entries(inputs).map(([binding, resource]) => ({
          binding: Number(binding),
          resource,
        })),
      }),
    ];
  }

  return {
    prefiltered,
    resize(nextWidth, nextHeight) {
      width = Math.max(1, Math.round(nextWidth));
      height = Math.max(1, Math.round(nextHeight));
      halfWidth = Math.ceil(width / 2);
      halfHeight = Math.ceil(height / 2);
    },
    encode(encoder, input, output, settings, profiler) {
      const p = input.projection;
      uniforms.set({
        // P[10], P[14], P[11], P[15] of a column-major projection; identity-like when absent.
        depth_to_distance: p ? [p[10]!, p[14]!, p[11]!, p[15]!] : [1, 0, 0, 1],
        out_size: [width, height],
        half_size: [halfWidth, halfHeight],
        focus: settings.focusDistance,
        band_half: settings.focusBand / 2,
        near_transition: settings.nearTransition,
        far_transition: settings.farTransition,
        max_radius: maxRadiusPixels(settings, height),
        line: settings.line,
        line_band: settings.lineBand,
        line_transition: settings.lineTransition,
        view: TILT_SHIFT_VIEWS.indexOf(settings.view ?? 'final'),
      });
      uniforms.upload();
      const timing = (pass: string) => ({ timestampWrites: profiler?.pass(`tilt-shift ${pass}`) });

      if (settings.method === 'screen') {
        for (const t of [screenDown, screenH, screenV]) t.resize(halfWidth, halfHeight);
        const down = pipeline('ts_screen_down', 'rgba16float');
        const h = pipeline('ts_screen_h', 'rgba16float');
        const v = pipeline('ts_screen_v', 'rgba16float');
        const composite = pipeline('ts_screen_composite', format);
        renderFullscreen(
          encoder,
          screenDown.view,
          down,
          groups(down, false, { 0: input.color }),
          timing('down'),
        );
        renderFullscreen(
          encoder,
          screenH.view,
          h,
          groups(h, true, { 2: screenDown.view }),
          timing('blur h'),
        );
        renderFullscreen(
          encoder,
          screenV.view,
          v,
          groups(v, true, { 8: screenH.view }),
          timing('blur v'),
        );
        renderFullscreen(
          encoder,
          output,
          composite,
          groups(composite, true, { 0: input.color, 8: screenV.view }),
          timing('composite'),
        );
        return;
      }

      if (!input.depth || !p) {
        throw new Error('createTiltShift: the depth method needs `depth` and `projection`');
      }
      for (const t of [prefiltered, spread, far, near]) t.resize(halfWidth, halfHeight);
      const tilesX = Math.ceil(width / TILE);
      const tilesY = Math.ceil(height / TILE);
      tileMax.resize(tilesX, tilesY);
      dilated.resize(tilesX, tilesY);

      const samples = input.depth.sampleCount;
      const depth = input.depth.createView();
      const prefilter = pipeline('ts_prefilter', 'rgba16float', samples);
      const spreadPass = pipeline('ts_spread', 'rgba16float');
      const tiles = pipeline('ts_tiles', 'r16float');
      const dilate = pipeline('ts_dilate', 'r16float');
      const gather = pipeline('ts_gather', ['rgba16float', 'rgba16float']);
      const composite = pipeline('ts_composite', format, samples);
      renderFullscreen(
        encoder,
        prefiltered.view,
        prefilter,
        groups(prefilter, false, { 0: input.color, 1: depth }),
        timing('prefilter'),
      );
      renderFullscreen(
        encoder,
        spread.view,
        spreadPass,
        groups(spreadPass, true, { 2: prefiltered.view }),
        timing('spread'),
      );
      renderFullscreen(
        encoder,
        tileMax.view,
        tiles,
        groups(tiles, false, { 2: prefiltered.view }),
        timing('tiles'),
      );
      renderFullscreen(
        encoder,
        dilated.view,
        dilate,
        groups(dilate, false, { 3: tileMax.view }),
        timing('dilate'),
      );
      renderFullscreen(
        encoder,
        [far.view, near.view],
        gather,
        groups(gather, true, { 7: spread.view, 4: dilated.view }),
        timing('gather'),
      );
      renderFullscreen(
        encoder,
        output,
        composite,
        groups(composite, true, { 0: input.color, 1: depth, 5: far.view, 6: near.view }),
        timing('composite'),
      );
    },
    destroy() {
      uniforms.destroy();
      for (const t of [
        prefiltered,
        spread,
        tileMax,
        dilated,
        far,
        near,
        screenDown,
        screenH,
        screenV,
      ]) {
        t.destroy();
      }
    },
  };
}
