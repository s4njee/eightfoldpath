import { describe, expect, it } from 'vitest';
import { mat4 } from 'wgpu-matrix';
import {
  cocFromDistance,
  cocFromRow,
  createTiltShift,
  DEFAULT_TILT_SHIFT,
  MAX_RADIUS,
  maxRadiusPixels,
  MIN_RADIUS,
  type TiltShiftSettings,
} from '../src/gpu/lens/tilt-shift.ts';
import { expectValid, getTestDevice, readTexture } from './gpu.ts';

// The tilt-shift lens (story 5.1) on synthetic inputs: flat planes of known depth drawn into a real
// depth buffer, and a colour image written directly, so every expectation is exact.

const WIDTH = 160;
const HEIGHT = 96;
const NEAR = 0.1;
const FAR = 200;
const projection = mat4.perspective((25 * Math.PI) / 180, WIDTH / HEIGHT, NEAR, FAR);

/** Focus at 25 units, sharp from 23.5 to 26.5, full blur 10 units beyond; 16 pixels at most. */
const SETTINGS: TiltShiftSettings = {
  ...DEFAULT_TILT_SHIFT,
  focusDistance: 25,
  focusBand: 3,
  nearTransition: 10,
  farTransition: 10,
  maxBlur: 16 / HEIGHT,
};
const RADIUS = maxRadiusPixels(SETTINGS, HEIGHT);

/** A rectangle of the image, in pixels, at a distance along the view axis. */
interface Plane {
  rect: readonly [number, number, number, number];
  distance: number;
}

/** The depth-buffer value of a point `distance` units along the view axis. */
function depthOf(distance: number): number {
  const p = projection;
  return (p[10]! * -distance + p[14]!) / distance;
}

function halfToFloat(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

interface Inputs {
  color: GPUTexture;
  depth: GPUTexture;
  output: GPUTexture;
  destroy(): void;
}

/** A colour image from `paint` (rgb per pixel) and a depth buffer holding `planes`, nearest wins. */
async function inputs(
  device: GPUDevice,
  paint: (x: number, y: number) => readonly [number, number, number],
  planes: readonly Plane[],
  sampleCount: 1 | 4 = 1,
): Promise<Inputs> {
  // rgba32float keeps the expectations exact; the lens only ever loads its input, never filters it.
  const color = device.createTexture({
    size: [WIDTH, HEIGHT],
    format: 'rgba32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const pixels = new Float32Array(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      pixels.set([...paint(x, y), 1], (y * WIDTH + x) * 4);
    }
  }
  device.queue.writeTexture({ texture: color }, pixels, { bytesPerRow: WIDTH * 16 }, [
    WIDTH,
    HEIGHT,
  ]);

  const depth = device.createTexture({
    size: [WIDTH, HEIGHT],
    format: 'depth24plus',
    sampleCount,
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
    multisample: { count: sampleCount },
  });
  const data = new Float32Array(Math.max(planes.length, 1) * 8);
  planes.forEach(({ rect, distance }, i) => data.set([...rect, depthOf(distance), 0, 0, 0], i * 8));
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

  const output = device.createTexture({
    size: [WIDTH, HEIGHT],
    format: 'rgba32float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  return {
    color,
    depth,
    output,
    destroy() {
      color.destroy();
      depth.destroy();
      output.destroy();
    },
  };
}

/** Runs the lens and returns its output as RGBA floats, plus the prefiltered circles. */
async function run(
  device: GPUDevice,
  input: Inputs,
  settings: TiltShiftSettings,
  withDepth = true,
): Promise<{ out: Float32Array; coc: (x: number, y: number) => number }> {
  const lens = createTiltShift(device, { format: 'rgba32float', label: 'test' });
  lens.resize(WIDTH, HEIGHT);
  await expectValid(device, async () => {
    const encoder = device.createCommandEncoder();
    lens.encode(
      encoder,
      withDepth
        ? { color: input.color.createView(), depth: input.depth, projection }
        : { color: input.color.createView() },
      input.output.createView(),
      settings,
    );
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  });
  const out = new Float32Array((await readTexture(device, input.output, 16)).buffer);
  const half = new Uint16Array((await readTexture(device, lens.prefiltered.texture, 8)).buffer);
  const halfWidth = lens.prefiltered.width;
  lens.destroy();
  return {
    out,
    coc: (x, y) => halfToFloat(half[(Math.floor(y / 2) * halfWidth + Math.floor(x / 2)) * 4 + 3]!),
  };
}

const red = (out: Float32Array, x: number, y: number) => out[(y * WIDTH + x) * 4]!;
const checker = (x: number, y: number) => {
  const v = (x + y) % 2 ? 1 : 0.1;
  return [v, v, v] as const;
};
const everywhere = [0, 0, WIDTH, HEIGHT] as const;

describe('tilt-shift circle of confusion (CPU twin)', () => {
  it('is zero inside the focus band and reaches the largest blur beyond the transition', () => {
    expect(cocFromDistance(25, SETTINGS, HEIGHT)).toBe(0);
    expect(cocFromDistance(26.4, SETTINGS, HEIGHT)).toBe(0);
    expect(cocFromDistance(23.6, SETTINGS, HEIGHT)).toBe(-0);
    expect(cocFromDistance(31.5, SETTINGS, HEIGHT)).toBeCloseTo(RADIUS / 2, 6);
    expect(cocFromDistance(36.5, SETTINGS, HEIGHT)).toBeCloseTo(RADIUS, 6);
    expect(cocFromDistance(FAR, SETTINGS, HEIGHT)).toBeCloseTo(RADIUS, 6);
    expect(cocFromDistance(10, SETTINGS, HEIGHT)).toBeCloseTo(-RADIUS, 6);
    // Each side ramps over its own transition.
    const steep = { ...SETTINGS, nearTransition: 2 };
    expect(cocFromDistance(22.5, steep, HEIGHT)).toBeCloseTo(-RADIUS / 2, 6);
    expect(cocFromDistance(31.5, steep, HEIGHT)).toBeCloseTo(RADIUS / 2, 6);
  });

  it('keeps the largest blur between the floor and the gather’s ceiling', () => {
    expect(maxRadiusPixels({ maxBlur: 0.015 }, 1080)).toBeCloseTo(16.2, 6);
    expect(maxRadiusPixels({ maxBlur: 0.015 }, 32)).toBe(MIN_RADIUS);
    expect(maxRadiusPixels({ maxBlur: 0.04 }, 2160)).toBe(MAX_RADIUS);
  });

  it('grows the screen method’s blur away from the line, negative below it', () => {
    const s = { ...SETTINGS, line: 0.5, lineBand: 0.1, lineTransition: 0.2 };
    expect(cocFromRow(48, s, HEIGHT)).toBe(0);
    expect(cocFromRow(0.42 * HEIGHT, s, HEIGHT)).toBe(0);
    expect(cocFromRow(0.2 * HEIGHT, s, HEIGHT)).toBeCloseTo(RADIUS, 6);
    expect(cocFromRow(0.9 * HEIGHT, s, HEIGHT)).toBeCloseTo(-RADIUS, 6);
  });
});

describe.each([1, 4] as const)('tilt-shift depth method, depth sample count %i', (samples) => {
  it('reads the circle of confusion from depth: none in focus, the most far away', async () => {
    const device = await getTestDevice();
    // Left third in focus, middle third far behind, right third near, nothing drawn in the bottom
    // rows (the cleared depth buffer: the far plane).
    const input = await inputs(
      device,
      checker,
      [
        { rect: [0, 0, 48, 80], distance: 25 },
        { rect: [48, 0, 112, 80], distance: 60 },
        { rect: [112, 0, 160, 80], distance: 12 },
      ],
      samples,
    );
    const { coc } = await run(device, input, SETTINGS);
    expect(coc(20, 40)).toBe(0);
    expect(coc(80, 40)).toBeCloseTo(RADIUS, 1);
    expect(coc(136, 40)).toBeCloseTo(-RADIUS, 1);
    expect(coc(80, 90)).toBeCloseTo(RADIUS, 1);
    input.destroy();
  });

  it('leaves an in-focus image exactly as it was', async () => {
    const device = await getTestDevice();
    const input = await inputs(device, checker, [{ rect: everywhere, distance: 25.5 }], samples);
    const { out } = await run(device, input, SETTINGS);
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) expect(red(out, x, y)).toBe(Math.fround(checker(x, y)[0]));
    }
    input.destroy();
  });

  it('keeps a blurred background off a sharp foreground, with no dark halo round it', async () => {
    const device = await getTestDevice();
    // A dark in-focus post (x 70..90) in front of a bright, far, blurred wall.
    const post = (x: number) => x >= 70 && x < 90;
    const input = await inputs(
      device,
      (x) => (post(x) ? [0, 0, 0] : [1, 1, 1]),
      [
        { rect: [70, 0, 90, HEIGHT], distance: 25 },
        { rect: everywhere, distance: 80 },
      ],
      samples,
    );
    const { out } = await run(device, input, SETTINGS);
    let inside = 0;
    let beside = 1;
    for (let y = 8; y < HEIGHT - 8; y++) {
      for (let x = 70; x < 90; x++) inside = Math.max(inside, red(out, x, y));
      for (const x of [66, 67, 92, 93]) beside = Math.min(beside, red(out, x, y));
    }
    // A naive blur of radius 16 would lift the post's edge to about 0.5 and darken the wall.
    expect(inside).toBeLessThan(0.02);
    expect(beside).toBeGreaterThan(0.9);
    input.destroy();
  });

  it('spreads a blurred foreground over the sharp edge behind it', async () => {
    const device = await getTestDevice();
    // A bright near panel over the left half, a dark in-focus wall behind everything.
    const input = await inputs(
      device,
      (x) => (x < 80 ? [1, 1, 1] : [0, 0, 0]),
      [
        { rect: [0, 0, 80, HEIGHT], distance: 8 },
        { rect: everywhere, distance: 25 },
      ],
      samples,
    );
    const { out } = await run(device, input, SETTINGS);
    const row = (x: number) => {
      let sum = 0;
      for (let y = 16; y < HEIGHT - 16; y++) sum += red(out, x, y);
      return sum / (HEIGHT - 32);
    };
    // Just past the edge the panel's light covers part of the wall, fading out by its radius.
    expect(row(82)).toBeGreaterThan(0.2);
    expect(row(82)).toBeGreaterThan(row(86));
    expect(row(86)).toBeGreaterThan(row(90));
    // Well beyond the radius the wall is untouched.
    expect(row(80 + RADIUS + 12)).toBe(0);
    input.destroy();
  });
});

describe('tilt-shift screen method', () => {
  it('keeps the band sharp, blurs beyond it and needs no depth', async () => {
    const device = await getTestDevice();
    // One-pixel vertical stripes: blurred, they average to 0.55.
    const stripes = (x: number) => {
      const v = x % 2 ? 1 : 0.1;
      return [v, v, v] as const;
    };
    const input = await inputs(device, stripes, []);
    const settings = {
      ...SETTINGS,
      method: 'screen' as const,
      line: 0.5,
      lineBand: 0.1,
      lineTransition: 0.15,
    };
    const { out } = await run(device, input, settings, false);
    // The band: 0.4 to 0.6 of the height, rows 38 to 57, plus the 1-pixel fade-in of the composite.
    for (let y = 40; y < 56; y++) {
      for (let x = 0; x < WIDTH; x++) expect(red(out, x, y)).toBe(Math.fround(stripes(x)[0]));
    }
    // Fully blurred rows, top and bottom.
    for (const y of [4, 10, 86, 92]) {
      for (let x = 20; x < WIDTH - 20; x++) expect(red(out, x, y)).toBeCloseTo(0.55, 1);
    }
    input.destroy();
  });

  it('refuses the depth method without depth', async () => {
    const device = await getTestDevice();
    const lens = createTiltShift(device);
    lens.resize(8, 8);
    const color = device.createTexture({
      size: [8, 8],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    expect(() =>
      lens.encode(
        device.createCommandEncoder(),
        { color: color.createView() },
        color.createView(),
        {
          ...SETTINGS,
          method: 'depth',
        },
      ),
    ).toThrow(/needs `depth`/);
    lens.destroy();
    color.destroy();
  });
});
