/*
 * The low-resolution render path (story 3.8): draw the scene into a small "virtual" image whose
 * pixels match the art's texels, with the camera snapped to whole virtual pixels, then scale it up
 * to the canvas, putting back the snapped-off fraction of the camera's motion as an offset.
 *
 *   const lowres = createLowResPath(device, { colorFormat: tail.scene.format });
 *   resize(w, h)  { size = virtualSize(w, h, 180); lowres.resize(size); }
 *   frame() {
 *     const shot = pixelCamera({ ...diorama, size, worldPerPixel: TEXEL, snap: true });
 *     view.update(shot.camera, ...);
 *     const pass = encoder.beginRenderPass(lowres.pass(clear));   // draw the scene as usual
 *     ...
 *     lowres.upscale(encoder, tail.scene.view, { offset: shot.offset, filter: 'sharp' });
 *   }
 *
 * Why the snap: a perspective or orthographic camera that moves by a fraction of a pixel makes the
 * rasteriser re-decide which texel every pixel shows, so texels grow and shrink by a pixel as they
 * slide ("swimming"). Moving the camera only by whole pixels of the virtual image, in its own
 * image plane, shifts the picture by whole pixels instead and leaves every texel the same shape.
 * With an orthographic camera that holds for the whole scene; with the diorama's perspective it
 * holds exactly at the focus depth and nearly so near it.
 *
 * Why the offset: a camera that moves in whole virtual pixels steps visibly, three or four screen
 * pixels at a time. The fraction it skipped is under half a virtual pixel, so the upscale samples
 * the virtual image that much to one side, and the picture glides again. The virtual image is
 * drawn a few pixels larger than the canvas needs (`margin`) so that shift never reaches its edge.
 */
import { mat4, vec3 } from 'wgpu-matrix';
import upscaleShader from '../../wgsl/lowres-upscale.wgsl';
import { createFullscreenPipeline, drawFullscreen } from '../fullscreen.ts';
import type { CameraState } from '../sprites/camera.ts';
import { dioramaCamera, framingDistance } from '../sprites/camera.ts';

export interface VirtualSize {
  /** Virtual pixels that cover the canvas. */
  readonly width: number;
  readonly height: number;
  /** Screen pixels per virtual pixel; a whole number when `integerScale` was asked for. */
  readonly scale: number;
  /** Extra virtual pixels drawn on every side, room for the sub-pixel offset and the filter. */
  readonly margin: number;
  /** The rendered image: width and height plus the margin on both sides. */
  readonly totalWidth: number;
  readonly totalHeight: number;
}

/**
 * The virtual image for a canvas. `targetHeight` is the virtual height asked for; with
 * `integerScale` the scale is rounded to a whole number first, so every virtual pixel is the same
 * number of screen pixels and the height lands near the target instead of on it. The scale never
 * drops below 1: a canvas smaller than the target gets a virtual image of its own size.
 */
export function virtualSize(
  canvasWidth: number,
  canvasHeight: number,
  targetHeight: number,
  options: { integerScale?: boolean; margin?: number } = {},
): VirtualSize {
  const margin = options.margin ?? 2;
  let scale = Math.max(1, canvasHeight / Math.max(1, targetHeight));
  if (options.integerScale) scale = Math.max(1, Math.round(scale));
  // A hair under, so that 540 / 3 is 180 and not 181 after rounding error.
  const width = Math.max(1, Math.ceil(canvasWidth / scale - 1e-6));
  const height = Math.max(1, Math.ceil(canvasHeight / scale - 1e-6));
  return {
    width,
    height,
    scale,
    margin,
    totalWidth: width + 2 * margin,
    totalHeight: height + 2 * margin,
  };
}

export interface PixelCameraOptions {
  /** Degrees below the horizon. */
  pitch: number;
  /** Radians about the vertical axis; 0 looks along -z. */
  yaw: number;
  /** Vertical field of view in degrees; ignored when orthographic. */
  fov: number;
  focus: readonly [number, number, number];
  /** World units one virtual pixel covers at the focus: `TEXEL` for one texel per pixel. */
  worldPerPixel: number;
  size: VirtualSize;
  projection?: 'perspective' | 'orthographic';
  /** Snap to whole virtual pixels. Off, the camera is exactly where it was asked to be. */
  snap?: boolean;
}

export interface PixelCamera {
  /** For drawing the virtual image, margin included. */
  readonly camera: CameraState;
  /**
   * What snapping took away, in virtual pixels, x right and y down the image (each within ±0.5):
   * give it to `upscale` to put the motion back.
   */
  readonly offset: readonly [number, number];
  /** The camera's right and up in world space, the plane the snap happens in. */
  readonly right: readonly [number, number, number];
  readonly up: readonly [number, number, number];
}

/** Right, up and forward of the diorama camera for a pitch (degrees) and yaw (radians). */
function basis(pitchDegrees: number, yaw: number) {
  const pitch = (pitchDegrees * Math.PI) / 180;
  const back = [
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(yaw) * Math.cos(pitch),
  ] as const;
  const forward = [-back[0], -back[1], -back[2]] as const;
  const right = vec3.normalize(vec3.cross(forward, [0, 1, 0]));
  const up = vec3.cross(right, forward);
  return {
    back,
    right: [right[0]!, right[1]!, right[2]!] as const,
    up: [up[0]!, up[1]!, up[2]!] as const,
  };
}

const dot = (a: readonly number[], b: readonly number[]) =>
  a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

/**
 * The diorama camera for the virtual image, snapped to its pixel grid. The grid is fixed to the
 * world (the camera's image plane through the world origin), so snapping is consistent from frame
 * to frame and between objects that are snapped with `snapToPixels`.
 */
export function pixelCamera(options: PixelCameraOptions): PixelCamera {
  const { size, worldPerPixel: unit } = options;
  const { back, right, up } = basis(options.pitch, options.yaw);
  let focus = [...options.focus] as [number, number, number];
  let offset: [number, number] = [0, 0];
  if (options.snap !== false) {
    const across = dot(focus, right) / unit;
    const along = dot(focus, up) / unit;
    const dx = Math.round(across) - across;
    const dy = Math.round(along) - along;
    focus = [
      focus[0] + (dx * right[0] + dy * up[0]) * unit,
      focus[1] + (dx * right[1] + dy * up[1]) * unit,
      focus[2] + (dx * right[2] + dy * up[2]) * unit,
    ];
    // The snapped camera sits `dx` pixels right of the true one, so the true picture is the
    // snapped one moved `dx` the other way; up in the world is down the image.
    offset = [-dx, dy];
  }

  const framedHeight = size.height * unit;
  const aspect = size.totalWidth / size.totalHeight;
  let camera: CameraState;
  if (options.projection === 'orthographic') {
    const distance = 100;
    const eye = vec3.add(focus, vec3.scale(back, distance));
    const view = mat4.lookAt(eye, focus, [0, 1, 0]);
    const halfWidth = (size.totalWidth * unit) / 2;
    const halfHeight = (size.totalHeight * unit) / 2;
    const projection = mat4.ortho(-halfWidth, halfWidth, -halfHeight, halfHeight, 1, distance * 2);
    camera = {
      viewProj: mat4.multiply(projection, view),
      view,
      projection,
      eye: [eye[0]!, eye[1]!, eye[2]!],
      right,
      up,
      forward: [-back[0], -back[1], -back[2]],
    };
  } else {
    // The field of view frames `size.height` virtual pixels at the focus; the margin widens it.
    const distance = framingDistance(options.fov, framedHeight);
    const halfAngle = Math.atan((size.totalHeight * unit) / 2 / distance);
    camera = dioramaCamera({
      pitch: options.pitch,
      yaw: options.yaw,
      fov: (halfAngle * 360) / Math.PI,
      focus,
      distance,
      aspect,
    });
  }
  return { camera, offset, right, up };
}

/**
 * Moves a standing object (feet on the ground) by under half a virtual pixel so it lands on the
 * pixel grid too: sideways along the camera's right, and along the ground toward or away from the
 * camera for the vertical part, so its feet stay on the ground. Exact for an orthographic camera,
 * and at the focus depth for a perspective one.
 */
export function snapToPixels(
  position: readonly [number, number, number],
  shot: PixelCamera,
  worldPerPixel: number,
): [number, number, number] {
  const across = dot(position, shot.right) / worldPerPixel;
  const along = dot(position, shot.up) / worldPerPixel;
  const dx = (Math.round(across) - across) * worldPerPixel;
  const dy = (Math.round(along) - along) * worldPerPixel;
  // Along the ground away from the camera; how far up the image one world unit of that moves.
  const ground = vec3.normalize([shot.up[0], 0, shot.up[2]]);
  const rise = dot([ground[0]!, 0, ground[2]!], shot.up);
  const away = rise > 1e-4 ? dy / rise : 0;
  return [
    position[0] + dx * shot.right[0] + away * ground[0]!,
    position[1],
    position[2] + dx * shot.right[2] + away * ground[2]!,
  ];
}

export const UPSCALE_FILTERS = ['nearest', 'bilinear', 'sharp'] as const;
export type UpscaleFilter = (typeof UPSCALE_FILTERS)[number];
const FILTER_CODE: Readonly<Record<UpscaleFilter | 'raw', number>> = {
  nearest: 0,
  bilinear: 1,
  sharp: 2,
  raw: 3,
};

export interface UpscaleSettings {
  /** `PixelCamera.offset`; zero to leave the snapped picture as it is. */
  offset: readonly [number, number];
  /** `raw` shows the whole virtual image, margin included, stretched across the target. */
  filter: UpscaleFilter | 'raw';
}

export interface LowResPath {
  readonly size: VirtualSize;
  /** The virtual image: the colour format asked for, at `size.totalWidth` × `totalHeight`. */
  readonly color: GPUTexture;
  /** Reallocates the virtual image when its size changed. */
  resize(size: VirtualSize, canvasWidth: number, canvasHeight: number): void;
  /** A pass that clears and draws into the virtual image, with a depth buffer of the same size. */
  pass(
    clear: readonly [number, number, number, number],
    timestampWrites?: GPURenderPassTimestampWrites,
  ): GPURenderPassDescriptor;
  /** Draws the virtual image across `target`, which must be the canvas size given to `resize`. */
  upscale(
    encoder: GPUCommandEncoder,
    target: GPUTextureView,
    settings: UpscaleSettings,
    timestampWrites?: GPURenderPassTimestampWrites,
  ): void;
  destroy(): void;
}

export function createLowResPath(
  device: GPUDevice,
  options: { colorFormat: GPUTextureFormat; depthFormat?: GPUTextureFormat; label?: string },
): LowResPath {
  const label = options.label ?? 'low-res';
  const depthFormat = options.depthFormat ?? 'depth24plus';
  const pipeline = createFullscreenPipeline(device, {
    fragment: upscaleShader,
    format: options.colorFormat,
    label: `${label} upscale`,
  });
  const sampler = device.createSampler({
    label: `${label} linear`,
    magFilter: 'linear',
    minFilter: 'linear',
  });
  const uniforms = device.createBuffer({
    label: `${label} upscale`,
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const data = new Float32Array(8);

  let size = virtualSize(1, 1, 1);
  let canvas: readonly [number, number] = [1, 1];
  let color: GPUTexture | undefined;
  let depth: GPUTexture | undefined;
  let bindGroup: GPUBindGroup | undefined;

  function allocate() {
    color?.destroy();
    depth?.destroy();
    color = device.createTexture({
      label: `${label} virtual`,
      size: [size.totalWidth, size.totalHeight],
      format: options.colorFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    depth = device.createTexture({
      label: `${label} virtual depth`,
      size: [size.totalWidth, size.totalHeight],
      format: depthFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    bindGroup = device.createBindGroup({
      label: `${label} upscale`,
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: color.createView() },
        { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: uniforms } },
      ],
    });
  }
  allocate();

  return {
    get size() {
      return size;
    },
    get color() {
      return color!;
    },
    resize(next, canvasWidth, canvasHeight) {
      canvas = [canvasWidth, canvasHeight];
      if (next.totalWidth === size.totalWidth && next.totalHeight === size.totalHeight) {
        size = next;
        return;
      }
      size = next;
      allocate();
    },
    pass(clear, timestampWrites) {
      return {
        label: `${label} virtual pass`,
        colorAttachments: [
          {
            view: color!.createView(),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: [...clear],
          },
        ],
        depthStencilAttachment: {
          view: depth!.createView(),
          depthLoadOp: 'clear',
          depthStoreOp: 'discard',
          depthClearValue: 1,
        },
        timestampWrites,
      };
    },
    upscale(encoder, target, settings, timestampWrites) {
      data.set([
        canvas[0],
        canvas[1],
        size.totalWidth,
        size.totalHeight,
        settings.offset[0],
        settings.offset[1],
        size.scale,
        FILTER_CODE[settings.filter],
      ]);
      device.queue.writeBuffer(uniforms, 0, data);
      const pass = encoder.beginRenderPass({
        label: `${label} upscale`,
        colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store' }],
        timestampWrites,
      });
      drawFullscreen(pass, pipeline, bindGroup!);
      pass.end();
    },
    destroy() {
      color?.destroy();
      depth?.destroy();
      uniforms.destroy();
    },
  };
}
