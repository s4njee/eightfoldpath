import { describe, expect, it } from 'vitest';
import { mat4 } from 'wgpu-matrix';
import {
  apertureArea,
  apertureRadius,
  bokehDrawn,
  bokehExcess,
  bokehHeld,
  createBokeh,
  DEFAULT_BOKEH,
  type BokehSettings,
} from '../src/gpu/lens/bokeh.ts';
import {
  createTiltShift,
  DEFAULT_TILT_SHIFT,
  maxRadiusPixels,
  type TiltShiftSettings,
} from '../src/gpu/lens/tilt-shift.ts';
import { expectValid, getTestDevice, readTexture } from './gpu.ts';

// Bokeh highlights (story 5.2) on synthetic inputs: a flat plane of known depth in a real depth
// buffer and a colour image written directly, with one bright block where a lantern would be.

const WIDTH = 160;
const HEIGHT = 128;
const projection = mat4.perspective((25 * Math.PI) / 180, WIDTH / HEIGHT, 0.1, 200);

/** Focus at 25, sharp from 23.5 to 26.5, full blur 10 units beyond; 24 pixels at most. */
const LENS: TiltShiftSettings = {
  ...DEFAULT_TILT_SHIFT,
  focusDistance: 25,
  focusBand: 3,
  nearTransition: 10,
  farTransition: 10,
  maxBlur: 24 / HEIGHT,
};
const RADIUS = maxRadiusPixels(LENS, HEIGHT);
const ROUND: BokehSettings = { ...DEFAULT_BOKEH, blades: 0, rim: 0, catEye: 0, threshold: 1.5 };
const HEXAGON: BokehSettings = { ...ROUND, blades: 6, curvature: 0 };

const luminance = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;

describe('bokeh extraction (CPU twins)', () => {
  it('takes only the light above the threshold, keeping its hue', () => {
    expect(bokehExcess([1, 1, 1], 1.5)).toEqual([0, 0, 0]);
    expect(bokehExcess([1.5, 1.5, 1.5], 1.5)).toEqual([0, 0, 0]);
    expect(bokehExcess([9, 9, 9], 0)).toEqual([0, 0, 0]);
    const lamp = [6, 3, 1] as const;
    const excess = bokehExcess(lamp, 1.5);
    // What is left is exactly at the threshold, so the split is continuous in brightness.
    const left = lamp.map((c, i) => c - excess[i]!);
    expect(luminance(left)).toBeCloseTo(1.5, 10);
    expect(excess[0] / excess[1]).toBeCloseTo(2, 10);
    expect(excess[1] / excess[2]).toBeCloseTo(3, 10);
    // Just over the threshold gives almost nothing: no pop as a light brightens through it.
    expect(luminance(bokehExcess([1.501, 1.501, 1.501], 1.5))).toBeLessThan(0.002);
  });

  it('holds back blurred blocks and draws them as the lens’s composite fades to the gather', () => {
    expect(bokehHeld(0)).toBe(false);
    expect(bokehHeld(0.9)).toBe(false);
    expect(bokehHeld(-1)).toBe(true);
    expect(bokehDrawn(0.5)).toBe(0);
    expect(bokehDrawn(1)).toBe(0);
    expect(bokehDrawn(2.5)).toBeCloseTo(0.5, 10);
    expect(bokehDrawn(-4)).toBe(1);
    expect(bokehDrawn(40)).toBe(1);
  });
});

describe('aperture shape (CPU twin)', () => {
  it('has the area of a circle, a hexagon and a rounded pentagon', () => {
    expect(apertureArea(0, 0, 0)).toBeCloseTo(Math.PI, 10);
    expect(apertureArea(6, 0, 0)).toBeCloseTo((3 * Math.sqrt(3)) / 2, 4);
    expect(apertureArea(5, 0.3, 0)).toBeCloseTo((5 / 2) * Math.sin((2 * Math.PI) / 5), 4);
    // Rounding the blades all the way gives the circle back; rotating changes nothing.
    expect(apertureArea(6, 0, 1)).toBeCloseTo(Math.PI, 4);
    expect(apertureArea(6, 0.4, 0.2)).toBeCloseTo(apertureArea(6, 0, 0.2), 4);
  });

  it('puts a hexagon’s corners on the blade angles and its flats between them', () => {
    expect(apertureRadius(0, 6, 0, 0)).toBeCloseTo(1, 10);
    expect(apertureRadius(Math.PI / 6, 6, 0, 0)).toBeCloseTo(Math.cos(Math.PI / 6), 10);
    expect(apertureRadius(Math.PI / 3, 6, 0, 0)).toBeCloseTo(1, 10);
    expect(apertureRadius(1.234, 0, 0, 0)).toBe(1);
  });
});

function halfToFloat(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

interface Plane {
  rect: readonly [number, number, number, number];
  distance: number;
}

/** A colour image from `paint` and a depth buffer holding `planes`, nearest wins. */
async function inputs(
  device: GPUDevice,
  paint: (x: number, y: number) => readonly [number, number, number],
  planes: readonly Plane[],
) {
  const color = device.createTexture({
    size: [WIDTH, HEIGHT],
    format: 'rgba32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const pixels = new Float32Array(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) pixels.set([...paint(x, y), 1], (y * WIDTH + x) * 4);
  }
  device.queue.writeTexture({ texture: color }, pixels, { bytesPerRow: WIDTH * 16 }, [
    WIDTH,
    HEIGHT,
  ]);
  const depth = device.createTexture({
    size: [WIDTH, HEIGHT],
    format: 'depth24plus',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const module = device.createShaderModule({
    code: `@group(0) @binding(0) var<storage, read> planes: array<vec4f>;
@vertex fn vs(@builtin(vertex_index) i: u32, @builtin(instance_index) p: u32) -> @builtin(position) vec4f {
  let rect = planes[p * 2u];
  let z = planes[p * 2u + 1u].x;
  let corner = array<vec2f, 6>(vec2f(0, 0), vec2f(1, 0), vec2f(0, 1), vec2f(0, 1), vec2f(1, 0), vec2f(1, 1))[i];
  let pixel = mix(rect.xy, rect.zw, corner);
  let size = vec2f(${WIDTH}.0, ${HEIGHT}.0);
  return vec4f(pixel.x / size.x * 2.0 - 1.0, 1.0 - pixel.y / size.y * 2.0, z, 1.0);
}`,
  });
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
  });
  const data = new Float32Array(Math.max(planes.length, 1) * 8);
  const p = projection;
  planes.forEach(({ rect, distance }, i) =>
    data.set([...rect, (p[10]! * -distance + p[14]!) / distance, 0, 0, 0], i * 8),
  );
  const buffer = device.createBuffer({
    size: data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buffer, 0, data);
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [],
    depthStencilAttachment: {
      view: depth.createView(),
      depthClearValue: 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(
    0,
    device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer } }],
    }),
  );
  pass.draw(6, planes.length);
  pass.end();
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  buffer.destroy();
  return {
    color,
    depth,
    destroy() {
      color.destroy();
      depth.destroy();
    },
  };
}

/** The lens alone (`bokeh` undefined) or the lens holding highlights back and the bokeh pass. */
async function run(
  device: GPUDevice,
  input: Awaited<ReturnType<typeof inputs>>,
  bokeh?: BokehSettings,
): Promise<{ red: (x: number, y: number) => number; total: number; wanted: number }> {
  const output = device.createTexture({
    size: [WIDTH, HEIGHT],
    format: 'rgba16float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const lens = createTiltShift(device, { label: 'test' });
  const pass = createBokeh(device, { label: 'test' });
  lens.resize(WIDTH, HEIGHT);
  pass.resize(WIDTH, HEIGHT);
  await expectValid(device, async () => {
    const encoder = device.createCommandEncoder();
    lens.encode(
      encoder,
      { color: input.color.createView(), depth: input.depth, projection },
      output.createView(),
      { ...LENS, bokehThreshold: bokeh?.threshold },
    );
    if (bokeh) {
      pass.encode(
        encoder,
        { color: input.color.createView(), prefiltered: lens.prefiltered },
        output.createView(),
        bokeh,
      );
    }
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  });
  const wanted = bokeh ? (await pass.readCount()).wanted : 0;
  const half = new Uint16Array((await readTexture(device, output, 8)).buffer);
  const red = (x: number, y: number) => halfToFloat(half[(y * WIDTH + x) * 4]!);
  let total = 0;
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) total += red(x, y);
  lens.destroy();
  pass.destroy();
  output.destroy();
  return { red, total, wanted };
}

const DARK = 0.02;
/** A 4 × 4 lantern of `value` at (cx, cy) on a dark ground. */
const lantern =
  (value: number, cx = 80, cy = 64) =>
  (x: number, y: number) => {
    const v = Math.abs(x + 0.5 - cx) < 2 && Math.abs(y + 0.5 - cy) < 2 ? value : DARK;
    return [v, v, v] as const;
  };
const everywhere = [0, 0, WIDTH, HEIGHT] as const;

describe('bokeh highlights on the tilt-shift lens', () => {
  it('draws a blurred lantern as a disc with the same light the lens alone gives it', async () => {
    const device = await getTestDevice();
    const input = await inputs(device, lantern(20), [{ rect: everywhere, distance: 60 }]);
    const plain = await run(device, input);
    const shaped = await run(device, input, ROUND);
    // Four blocks of 2 × 2 pixels, one record each.
    expect(shaped.wanted).toBe(4);
    const ground = DARK * WIDTH * HEIGHT;
    const light = 20 * 16 - DARK * 16;
    expect((plain.total - ground) / light).toBeCloseTo(1, 1);
    expect((shaped.total - ground) / light).toBeCloseTo(1, 1);
    // A disc, not a soft blob: flat across the middle, and nothing beyond its edge.
    const inner = shaped.red(80 + Math.round(RADIUS * 0.6), 64);
    expect(inner).toBeGreaterThan(0.6 * shaped.red(80, 64));
    expect(shaped.red(80 + RADIUS + 4, 64)).toBeCloseTo(DARK, 2);
    input.destroy();
  });

  it('gives the disc the aperture’s shape: corners where the blades meet, flats between', async () => {
    const device = await getTestDevice();
    // One 2 × 2 block, so one disc centred on (81, 65), its pixels' centroid.
    const point = (x: number, y: number) => {
      const v = (x === 80 || x === 81) && (y === 64 || y === 65) ? 160 : DARK;
      return [v, v, v] as const;
    };
    const input = await inputs(device, point, [{ rect: everywhere, distance: 60 }]);
    const { red, wanted } = await run(device, input, HEXAGON);
    expect(wanted).toBe(1);
    // Between the flat's distance (cos 30° = 0.866 of the radius) and the corner's (1).
    const r = RADIUS * 0.95;
    const at = (angle: number) =>
      red(Math.round(81 + r * Math.cos(angle)), Math.round(65 + r * Math.sin(angle)));
    for (let k = 0; k < 6; k++) {
      expect(at((k * Math.PI) / 3)).toBeGreaterThan(0.2);
      expect(at((k * Math.PI) / 3 + Math.PI / 6)).toBeLessThan(DARK + 0.02);
    }
    input.destroy();
  });

  it('leaves lights under the threshold, and lights in focus, to the lens', async () => {
    const device = await getTestDevice();
    const dim = await inputs(device, lantern(1.2), [{ rect: everywhere, distance: 60 }]);
    const plain = await run(device, dim);
    const shaped = await run(device, dim, ROUND);
    expect(shaped.wanted).toBe(0);
    for (const [x, y] of [
      [80, 64],
      [90, 64],
      [80, 80],
    ] as const) {
      expect(shaped.red(x, y)).toBe(plain.red(x, y));
    }
    dim.destroy();

    const sharp = await inputs(device, lantern(20), [{ rect: everywhere, distance: 25 }]);
    const inFocus = await run(device, sharp, ROUND);
    expect(inFocus.wanted).toBe(0);
    expect(inFocus.red(80, 64)).toBeCloseTo(20, 1);
    sharp.destroy();
  });

  it('hides a far disc behind a sharp foreground', async () => {
    const device = await getTestDevice();
    // A dark in-focus post (x 88..112) just right of a far lantern.
    const paint = (x: number, y: number) =>
      x >= 88 && x < 112 ? ([0, 0, 0] as const) : lantern(20)(x, y);
    const input = await inputs(device, paint, [
      { rect: [88, 0, 112, HEIGHT], distance: 25 },
      { rect: everywhere, distance: 60 },
    ]);
    const { red } = await run(device, input, ROUND);
    expect(red(80, 64)).toBeGreaterThan(0.1);
    for (let x = 90; x < 104; x++) expect(red(x, 64)).toBeLessThan(0.01);
    input.destroy();
  });
});
