import { describe, expect, it } from 'vitest';
import { vec3 } from 'wgpu-matrix';
import type { Pixels } from '../src/gpu/assets.ts';
import {
  createOutlinePass,
  OUTLINE_DEPTH_FORMAT,
  OUTLINE_GBUFFER_FORMAT,
  type OutlineSettings,
} from '../src/gpu/lighting/outline.ts';
import { pickSprite } from '../src/gpu/lighting/outline-pick.ts';
import { dioramaCamera, type CameraState } from '../src/gpu/sprites/camera.ts';
import { expectValid, getTestDevice, readTexture } from './gpu.ts';

describe('pickSprite', () => {
  const camera = dioramaCamera({
    pitch: 35,
    yaw: 0.3,
    fov: 25,
    focus: [0, 1, 0],
    distance: 20,
    aspect: 16 / 9,
  });

  /** Where a world point lands on the screen, in the pointer's 0..1 top-left space. */
  function screen(point: readonly [number, number, number], view: CameraState = camera) {
    const clip = vec3.transformMat4(point, view.viewProj);
    return { x: (clip[0]! + 1) / 2, y: (1 - clip[1]!) / 2 };
  }

  /** 4 x 4 texels, opaque only in the left half: a sprite whose right side is empty. */
  const halfSolid: Pixels = {
    width: 4,
    height: 4,
    data: new Uint8Array(
      Array.from({ length: 16 }, (_, i) => [200, 100, 50, i % 4 < 2 ? 255 : 0]).flat(),
    ),
  };
  // 4 texels at 16 a unit is a quarter unit; scale 8 makes each sprite two units square.
  const at = (x: number, z: number, flipX = false) => ({
    sheet: 0,
    position: [x, 0, z] as const,
    scale: 8,
    flipX,
  });
  // Points one unit up the sprite, half a unit either side of its centre line, along the
  // camera's horizontal right vector (the way upright sprites turn).
  const right = vec3.normalize([camera.right[0], 0, camera.right[2]]);
  const beside = (x: number, z: number, side: number) =>
    screen([x + right[0]! * 0.5 * side, 1, z + right[2]! * 0.5 * side]);

  const pick = (point: { x: number; y: number }, sprites = [at(0, 0)], occluders = []) =>
    pickSprite({ camera, ...point, sprites, sheets: [halfSolid], time: 0, occluders });

  it('hits opaque art and passes through transparent texels', () => {
    expect(pick(beside(0, 0, -1))).toBe(0);
    expect(pick(beside(0, 0, 1))).toBe(-1);
    expect(pick(screen([0, 3, 0]))).toBe(-1);
  });

  it('honours flipX', () => {
    expect(pick(beside(0, 0, -1), [at(0, 0, true)])).toBe(-1);
    expect(pick(beside(0, 0, 1), [at(0, 0, true)])).toBe(0);
  });

  it('picks the front-most of two overlapping sprites', () => {
    // The camera sits at +z, so the sprite at z = 1 is in front.
    const point = beside(0, 1, -1);
    expect(pick(point, [at(0, 0), at(0, 1)])).toBe(1);
    expect(pick(point, [at(0, 1), at(0, 0)])).toBe(0);
  });

  it('lets a box in front hide a sprite', () => {
    const point = beside(0, 0, -1);
    const wall = { min: [-3, 0, 1] as const, max: [3, 3, 1.5] as const };
    expect(
      pickSprite({
        camera,
        ...point,
        sprites: [at(0, 0)],
        sheets: [halfSolid],
        time: 0,
        occluders: [wall],
      }),
    ).toBe(-1);
    const behind = { min: [-3, 0, -2] as const, max: [3, 3, -1.5] as const };
    expect(
      pickSprite({
        camera,
        ...point,
        sprites: [at(0, 0)],
        sheets: [halfSolid],
        time: 0,
        occluders: [behind],
      }),
    ).toBe(0);
  });
});

/** Float to IEEE half, for the normal, finite values these tests write. */
function half(value: number): number {
  const bits = new Uint32Array(new Float32Array([value]).buffer)[0]!;
  const sign = (bits >>> 16) & 0x8000;
  const exponent = ((bits >>> 23) & 0xff) - 127 + 15;
  if (value === 0 || exponent <= 0) return sign;
  return sign | (exponent << 10) | ((bits >>> 13) & 0x3ff);
}

const WIDTH = 8;
const HEIGHT = 4;
const NEAR = 0.1;
const FAR = 200;
/** The depth buffer value wgpu-matrix's perspective gives a point at view distance `z`. */
const depthAt = (z: number) => (FAR / (FAR - NEAR)) * (1 - NEAR / z);

interface Halves {
  normal: (x: number) => readonly [number, number];
  id: (x: number) => number;
  z: (x: number) => number;
}

describe('outline pass', () => {
  /**
   * Draws the outline pass's `edges` view over an 8 x 4 picture split down the middle, and
   * returns which sources marked each column (red depth, green normal, blue ID, from row 1).
   */
  async function edges(scene: Halves, selection?: { z: number; columns: [number, number] }) {
    const device = await getTestDevice();
    const gbuffer = device.createTexture({
      size: [WIDTH, HEIGHT],
      format: OUTLINE_GBUFFER_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const g = new Uint16Array(WIDTH * HEIGHT * 4);
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const [nx, ny] = scene.normal(x);
        g.set([half(nx), half(ny), half(scene.id(x)), half(1)], (y * WIDTH + x) * 4);
      }
    }
    device.queue.writeTexture({ texture: gbuffer }, g, { bytesPerRow: WIDTH * 8 }, [WIDTH, HEIGHT]);

    // Depth cannot be a copy destination, so it is drawn: a fullscreen pass writes frag_depth
    // from an r32float texture of the wanted values.
    const values = device.createTexture({
      size: [WIDTH, HEIGHT],
      format: 'r32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const module = device.createShaderModule({
      code: /* wgsl */ `
        @group(0) @binding(0) var values: texture_2d<f32>;
        @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
          let c = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
          return vec4f(c * 2.0 - 1.0, 0.0, 1.0);
        }
        @fragment fn fs(@builtin(position) p: vec4f) -> @builtin(frag_depth) f32 {
          return textureLoad(values, vec2i(p.xy), 0).r;
        }`,
    });
    const writer = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [] },
      depthStencil: {
        format: OUTLINE_DEPTH_FORMAT,
        depthWriteEnabled: true,
        depthCompare: 'always',
      },
    });
    // writeTexture lands before any later submit, so each depth texture is drawn and submitted
    // before the next one's values are written.
    const drawDepth = (column: (x: number) => number) => {
      device.queue.writeTexture(
        { texture: values },
        new Float32Array(Array.from({ length: WIDTH * HEIGHT }, (_, i) => column(i % WIDTH))),
        { bytesPerRow: WIDTH * 4 },
        [WIDTH, HEIGHT],
      );
      const texture = device.createTexture({
        size: [WIDTH, HEIGHT],
        format: OUTLINE_DEPTH_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [],
        depthStencilAttachment: {
          view: texture.createView(),
          depthLoadOp: 'clear',
          depthClearValue: 1,
          depthStoreOp: 'store',
        },
      });
      pass.setPipeline(writer);
      pass.setBindGroup(
        0,
        device.createBindGroup({
          layout: writer.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: values.createView() }],
        }),
      );
      pass.draw(3);
      pass.end();
      device.queue.submit([encoder.finish()]);
      return texture;
    };
    const depth = drawDepth((x) => depthAt(scene.z(x)));
    const mask =
      selection &&
      drawDepth((x) =>
        x >= selection.columns[0] && x <= selection.columns[1] ? depthAt(selection.z) : 1,
      );

    const target = device.createTexture({
      size: [WIDTH, HEIGHT],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const settings: OutlineSettings = {
      depthThreshold: 0.02,
      normalAngle: 40,
      ink: [0, 0, 0],
      inkOpacity: 1,
      selectionColor: [1, 1, 0],
      hiddenOpacity: 0.5,
      near: NEAR,
      far: FAR,
      view: 'edges',
    };
    const outline = createOutlinePass(device, { format: 'rgba8unorm' });
    await expectValid(device, () => {
      const encoder = device.createCommandEncoder();
      outline.encode(encoder, {
        target: target.createView(),
        gbuffer: gbuffer.createView(),
        depth: depth.createView(),
        selection: mask?.createView(),
        settings,
      });
      device.queue.submit([encoder.finish()]);
    });
    const pixels = await readTexture(device, target);
    outline.destroy();
    for (const texture of [gbuffer, values, depth, target, mask]) texture?.destroy();
    // Row 1, so the top and bottom borders of the picture play no part.
    return Array.from({ length: WIDTH }, (_, x) => {
      const i = (WIDTH + x) * 4;
      return [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!] as const;
    });
  }

  const flat = [0, 0] as const;
  const left = (x: number) => x < 4;

  it('draws a depth step on the nearer side only, one pixel wide', async () => {
    const row = await edges({ normal: () => flat, id: () => 1, z: (x) => (left(x) ? 10 : 20) });
    expect(row.map(([r]) => r > 128)).toEqual([
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(row.every(([, g, b]) => g === 0 && b === 0)).toBe(true);
  });

  it('ignores the steady depth change across a slanted plane', async () => {
    // 1/z linear in x: a plane receding to the right at a grazing angle, 10% farther per pixel.
    const row = await edges({ normal: () => flat, id: () => 1, z: (x) => 1 / (0.1 - x * 0.009) });
    expect(row.every(([r, g, b]) => r + g + b === 0)).toBe(true);
  });

  it('draws a crease on the side that faces the camera less', async () => {
    // Same depth and object; the right half is turned 53 degrees to the side.
    const row = await edges({
      normal: (x) => (left(x) ? flat : [0.8, 0]),
      id: () => 1,
      z: () => 10,
    });
    expect(row.map(([, g]) => g > 128)).toEqual([
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ]);
    expect(row.every(([r, , b]) => r === 0 && b === 0)).toBe(true);
  });

  it('separates two objects at the same depth and angle by ID alone', async () => {
    const row = await edges({ normal: () => flat, id: (x) => (left(x) ? 2 : 3), z: () => 10 });
    expect(row.map(([, , b]) => b > 128)).toEqual([
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(row.every(([r, g]) => r === 0 && g === 0)).toBe(true);
  });

  it('rings the selection outside its silhouette, dimmed where it is hidden', async () => {
    const scene: Halves = { normal: () => flat, id: () => 1, z: () => 10 };
    const visible = await edges(scene, { z: 10, columns: [3, 4] });
    expect(visible.map(([r]) => r)).toEqual([0, 0, 255, 0, 0, 255, 0, 0]);
    // Behind the scene's surface: the same ring at half strength.
    const hidden = await edges(scene, { z: 15, columns: [3, 4] });
    expect(hidden.map(([r]) => Math.abs(r - 128) <= 1)).toEqual([
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
    ]);
  });
});
