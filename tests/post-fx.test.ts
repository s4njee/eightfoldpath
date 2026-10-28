import { describe, expect, it } from 'vitest';
import { AREA_LOOKS, TIME_LOOKS, VILLAGE_AREAS } from '../src/effects/colour-grading/looks.ts';
import { srgbToLinear, linearToSrgb } from '../src/gpu/palette/oklab.ts';
import { createOutputPass } from '../src/gpu/post/index.ts';
import {
  applyLook,
  applyLooks,
  areaAt,
  buildGradeLut,
  createFinishingPass,
  createGradeLuts,
  createPixelBloom,
  finishActive,
  GRADE_LUT_SIZE,
  mixLuts,
  sampleGradeLut,
  toHalf,
  type FinishSettings,
  type GradeLook,
  type PixelBloomSettings,
} from '../src/gpu/post-fx/index.ts';
import { expectValid, getTestDevice, readTexture } from './gpu.ts';

// Stories 5.4, 5.7 and 5.8: the pixel bloom source, the grade tables and their crossfade, and the
// finishing pass's vignette, aberration and grain.

const USAGE =
  GPUTextureUsage.RENDER_ATTACHMENT |
  GPUTextureUsage.TEXTURE_BINDING |
  GPUTextureUsage.COPY_SRC |
  GPUTextureUsage.COPY_DST;

function halfValue(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const mantissa = bits & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (mantissa / 1024);
  if (exponent === 0x1f) return mantissa ? NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + mantissa / 1024);
}

/** An rgba16float texture whose texel (x, y) is `colour(x, y)`, alpha 1. */
function halfTexture(
  device: GPUDevice,
  width: number,
  height: number,
  colour: (x: number, y: number) => readonly number[],
): GPUTexture {
  const texture = device.createTexture({
    size: [width, height],
    format: 'rgba16float',
    usage: USAGE,
  });
  const bits = new Uint16Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r = 0, g = 0, b = 0] = colour(x, y);
      bits.set([toHalf(r), toHalf(g), toHalf(b), toHalf(1)], (y * width + x) * 4);
    }
  }
  device.queue.writeTexture({ texture }, bits, { bytesPerRow: width * 8, rowsPerImage: height }, [
    width,
    height,
  ]);
  return texture;
}

async function readHalf(device: GPUDevice, texture: GPUTexture): Promise<number[]> {
  const bits = new Uint16Array((await readTexture(device, texture, 8)).buffer);
  return Array.from(bits, halfValue);
}

const DUSK_SQUARE: readonly GradeLook[] = [TIME_LOOKS.dusk, AREA_LOOKS['the square']!];

describe('grade looks and tables', () => {
  it('converts to half floats with rounding and subnormals', () => {
    expect(toHalf(0)).toBe(0);
    expect(toHalf(1)).toBe(0x3c00);
    expect(toHalf(0.5)).toBe(0x3800);
    expect(toHalf(-2)).toBe(0xc000);
    expect(toHalf(65504)).toBe(0x7bff);
    expect(toHalf(1e6)).toBe(0x7c00);
    expect(toHalf(2 ** -24)).toBe(1);
    for (let i = 0; i < 200; i++) {
      const v = (i / 199) * 4 - 1;
      expect(Math.abs(halfValue(toHalf(v)) - v)).toBeLessThanOrEqual(
        Math.abs(v) * 2 ** -11 + 2 ** -25,
      );
    }
  });

  it('leaves colour alone with no look, and its table is the identity', () => {
    expect(applyLook({}, [0.2, 0.5, 0.9])).toEqual([0.2, 0.5, 0.9]);
    const lut = buildGradeLut([]);
    const n = GRADE_LUT_SIZE;
    expect(lut[((5 * n + 7) * n + 11) * 4]).toBeCloseTo(11 / (n - 1), 6);
    expect(lut[((5 * n + 7) * n + 11) * 4 + 1]).toBeCloseTo(7 / (n - 1), 6);
    expect(lut[((5 * n + 7) * n + 11) * 4 + 2]).toBeCloseTo(5 / (n - 1), 6);
    for (const colour of [
      [0, 0, 0],
      [1, 1, 1],
      [0.123, 0.456, 0.789],
      [0.999, 0.001, 0.5],
    ] as const) {
      const out = sampleGradeLut(lut, colour);
      for (let c = 0; c < 3; c++) expect(out[c]).toBeCloseTo(colour[c]!, 6);
    }
  });

  it('every village look changes the picture, and the time looks differ from each other', () => {
    const colours = [
      [0.5, 0.5, 0.5],
      [0.6, 0.45, 0.3],
      [0.2, 0.35, 0.6],
      [0.15, 0.15, 0.15],
    ] as const;
    const shifted = (look: GradeLook) =>
      Math.max(
        ...colours.flatMap((colour) =>
          applyLook(look, colour).map((c, i) => Math.abs(c - colour[i]!)),
        ),
      );
    for (const look of [...Object.values(TIME_LOOKS), ...Object.values(AREA_LOOKS)]) {
      expect(shifted(look)).toBeGreaterThan(2 / 255);
    }
    const day = applyLook(TIME_LOOKS.day, [0.4, 0.4, 0.4]);
    const night = applyLook(TIME_LOOKS.night, [0.4, 0.4, 0.4]);
    expect(night[2] - night[0]).toBeGreaterThan(day[2] - day[0]);
  });

  // Why the table is indexed by the encoded colour: interpolating it stays within a step of the
  // exact look nearly everywhere. The misses are saturated colours where a channel is clipped
  // (applyLook's comment). The same 32 cells spread over linear light do far worse in the darks.
  it('a 32³ table on encoded colour is close to the exact look, and closer than on linear', () => {
    const errors = (indexLinear: boolean) => {
      const out: number[] = [];
      const n = GRADE_LUT_SIZE;
      for (const time of Object.values(TIME_LOOKS)) {
        for (const area of Object.values(AREA_LOOKS)) {
          const looks = [time, area];
          let lut = buildGradeLut(looks);
          if (indexLinear) {
            lut = new Float32Array(lut.length);
            let j = 0;
            for (let b = 0; b < n; b++)
              for (let g = 0; g < n; g++)
                for (let r = 0; r < n; r++) {
                  const at = [r, g, b].map((v) => linearToSrgb(v / (n - 1))) as [
                    number,
                    number,
                    number,
                  ];
                  lut.set([...applyLooks(looks, at), 1], j);
                  j += 4;
                }
          }
          for (let i = 0; i < 3000; i++) {
            // A fixed low-discrepancy walk through the cube.
            const colour = [(i * 0.618034) % 1, (i * 0.7548777) % 1, (i * 0.5698403) % 1] as const;
            const exact = applyLooks(looks, colour);
            const index = indexLinear
              ? (colour.map(srgbToLinear) as [number, number, number])
              : colour;
            const table = sampleGradeLut(lut, index);
            out.push(Math.max(...[0, 1, 2].map((c) => Math.abs(exact[c]! - table[c]!) * 255)));
          }
        }
      }
      return out.sort((a, b) => a - b);
    };
    const encoded = errors(false);
    const linear = errors(true);
    const over = (list: number[]) => list.filter((e) => e > 1).length / list.length;
    const median = (list: number[]) => list[Math.floor(list.length / 2)]!;
    expect(median(encoded)).toBeLessThan(0.1);
    expect(over(encoded)).toBeLessThan(0.06);
    expect(over(linear)).toBeGreaterThan(over(encoded) * 3);
  });

  it('mixes tables linearly, with each table at its end', () => {
    const a = buildGradeLut([TIME_LOOKS.day], 4);
    const b = buildGradeLut([TIME_LOOKS.night], 4);
    expect(mixLuts(a, b, 0, new Float32Array(a.length))).toEqual(a);
    expect(mixLuts(a, b, 1, new Float32Array(a.length))).toEqual(b);
    const half = mixLuts(a, b, 0.5, new Float32Array(a.length));
    expect(half[17]).toBeCloseTo((a[17]! + b[17]!) / 2, 6);
  });

  it('finds the area under a point, holding the current one near a border', () => {
    expect(areaAt(VILLAGE_AREAS, 11, 9.5)).toBe('the square');
    expect(areaAt(VILLAGE_AREAS, 11, 3)).toBe('the road on');
    expect(areaAt(VILLAGE_AREAS, 11, 14)).toBe('the shore');
    // Just over the border into the square, still the road until well past it.
    expect(areaAt(VILLAGE_AREAS, 11, 7.9, 'the road on')).toBe('the road on');
    expect(areaAt(VILLAGE_AREAS, 11, 8.5, 'the road on')).toBe('the square');
    expect(areaAt(VILLAGE_AREAS, -50, -50, 'the shore')).toBe('the shore');
  });
});

describe('the finishing pass', () => {
  const WIDTH = 64;
  const HEIGHT = 48;

  async function finish(
    source: GPUTexture,
    settings: FinishSettings,
    size: readonly [number, number] = [WIDTH, HEIGHT],
  ): Promise<Uint8Array> {
    const device = await getTestDevice();
    const target = device.createTexture({ size: [...size], format: 'rgba8unorm', usage: USAGE });
    const pass = createFinishingPass(device, { format: 'rgba8unorm' });
    await expectValid(device, () => {
      const encoder = device.createCommandEncoder();
      pass.encode(encoder, target.createView(), source.createView(), size, settings);
      device.queue.submit([encoder.finish()]);
    });
    const pixels = await readTexture(device, target);
    pass.destroy();
    target.destroy();
    return pixels;
  }

  /** Every 8-bit value on each channel, in a pattern that mixes them (sRGB-encoded input). */
  const ramp = (x: number, y: number) => [
    ((x * 4 + y) % 256) / 255,
    ((y * 5 + x * 3) % 256) / 255,
    ((x * 7 + y * 11) % 256) / 255,
  ];
  const expected = (x: number, y: number) => ramp(x, y).map((v) => Math.round(v * 255));

  it('does nothing it is not asked to', () => {
    expect(finishActive({ frame: 3, dither: 1 })).toBe(false);
    expect(finishActive({ grain: 1 })).toBe(true);
  });

  it('an identity table leaves the image unchanged', async () => {
    const device = await getTestDevice();
    const source = halfTexture(device, WIDTH, HEIGHT, ramp);
    const grades = createGradeLuts(device);
    const pixels = await finish(source, { grade: grades.input, dither: 0 });
    let worst = 0;
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const want = expected(x, y);
        for (let c = 0; c < 3; c++) {
          worst = Math.max(worst, Math.abs(pixels[(y * WIDTH + x) * 4 + c]! - want[c]!));
        }
      }
    }
    expect(worst).toBe(0);
    grades.destroy();
    source.destroy();
  });

  it('matches the CPU table and crossfades from one table to the other', async () => {
    const device = await getTestDevice();
    const source = halfTexture(device, WIDTH, HEIGHT, ramp);
    const day = [TIME_LOOKS.day];
    const night = [TIME_LOOKS.night];
    const grades = createGradeLuts(device, { key: 'day', looks: day });
    const atDay = await finish(source, { grade: grades.input, dither: 0 });

    grades.show('night', night, 2);
    expect(grades.mix).toBe(0);
    const start = await finish(source, { grade: grades.input, dither: 0 });
    expect(Buffer.from(start).equals(Buffer.from(atDay))).toBe(true);

    grades.update(1);
    expect(grades.mix).toBeCloseTo(0.5, 6);
    const middle = await finish(source, { grade: grades.input, dither: 0 });
    grades.update(1);
    expect(grades.mix).toBe(1);
    const end = await finish(source, { grade: grades.input, dither: 0 });

    const dayLut = buildGradeLut(day);
    const nightLut = buildGradeLut(night);
    let worstEnd = 0;
    let worstMiddle = 0;
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const i = (y * WIDTH + x) * 4;
        const a = sampleGradeLut(dayLut, ramp(x, y) as [number, number, number]);
        const b = sampleGradeLut(nightLut, ramp(x, y) as [number, number, number]);
        for (let c = 0; c < 3; c++) {
          worstEnd = Math.max(worstEnd, Math.abs(end[i + c]! - b[c]! * 255));
          worstMiddle = Math.max(
            worstMiddle,
            Math.abs(middle[i + c]! - ((a[c]! + b[c]!) / 2) * 255),
          );
        }
      }
    }
    expect(worstEnd).toBeLessThan(1);
    expect(worstMiddle).toBeLessThan(1);

    // A new look mid-fade starts from the blend on screen, not from either end.
    grades.show('day again', day, 2);
    grades.update(1);
    grades.show('dusk', [TIME_LOOKS.dusk], 2);
    const restart = await finish(source, { grade: grades.input, dither: 0 });
    let worstRestart = 0;
    for (let i = 0; i < restart.length; i += 4) {
      for (let c = 0; c < 3; c++)
        worstRestart = Math.max(worstRestart, Math.abs(restart[i + c]! - middle[i + c]!));
    }
    expect(worstRestart).toBeLessThanOrEqual(1);
    grades.destroy();
    source.destroy();
  });

  it('darkens toward the corners, symmetrically, and leaves the middle alone', async () => {
    const device = await getTestDevice();
    const grey = 0.6;
    const source = halfTexture(device, WIDTH, HEIGHT, () => [grey, grey, grey]);
    const pixels = await finish(source, {
      vignette: 0.3,
      vignetteRadius: 0.3,
      vignetteSoftness: 0.7,
      dither: 0,
    });
    const at = (x: number, y: number) => pixels[(y * WIDTH + x) * 4 + 1]!;
    const middle = Math.round(grey * 255);
    expect(at(WIDTH / 2, HEIGHT / 2)).toBe(middle);
    // Along the diagonal from the centre to a corner, never brighter on the way out.
    let previous = 255;
    for (let k = 0; k <= 23; k++) {
      const v = at(WIDTH / 2 + k, HEIGHT / 2 + Math.round((k * (HEIGHT / 2 - 1)) / 23));
      expect(v).toBeLessThanOrEqual(previous);
      previous = v;
    }
    expect(at(0, 0)).toBeLessThan(middle - 20);
    expect(Math.abs(at(0, 0) - at(WIDTH - 1, HEIGHT - 1))).toBeLessThanOrEqual(1);
    expect(Math.abs(at(3, HEIGHT / 2) - at(WIDTH - 4, HEIGHT / 2))).toBeLessThanOrEqual(1);
    source.destroy();
  });

  it('shifts red and blue apart along the radius, growing toward the edges', async () => {
    const device = await getTestDevice();
    const size = [216, 216] as const;
    // Fine stripes both ways, so any shift shows.
    const stripes = (x: number, y: number) => {
      const v = (Math.floor(x / 3) + Math.floor(y / 3)) % 2 ? 0.9 : 0.1;
      return [v, v, v];
    };
    const source = halfTexture(device, ...size, stripes);
    // 6 px at 1080p is 1.2 px at the corners of a 216 px canvas.
    const pixels = await finish(source, { aberration: 6, dither: 0 }, size);
    const plain = await finish(source, { dither: 0 }, size);
    const ring = (r0: number, r1: number) => {
      let sum = 0;
      let count = 0;
      for (let y = 0; y < size[1]; y++) {
        for (let x = 0; x < size[0]; x++) {
          const r =
            Math.hypot(x + 0.5 - size[0] / 2, y + 0.5 - size[1] / 2) /
            Math.hypot(size[0] / 2, size[1] / 2);
          if (r < r0 || r >= r1) continue;
          const i = (y * size[0] + x) * 4;
          sum += Math.abs(pixels[i]! - plain[i]!) + Math.abs(pixels[i + 2]! - plain[i + 2]!);
          // Green is never moved.
          expect(pixels[i + 1]).toBe(plain[i + 1]);
          count++;
        }
      }
      return sum / count;
    };
    const centre = ring(0, 0.1);
    const middle = ring(0.45, 0.55);
    const edge = ring(0.9, 1);
    expect(centre).toBeLessThan(1);
    expect(middle).toBeGreaterThan(centre);
    expect(edge).toBeGreaterThan(middle * 2);
    source.destroy();
  });

  it('adds zero-mean grain that moves every frame and spares black and white', async () => {
    const device = await getTestDevice();
    const size = [128, 128] as const;
    const grey = 128 / 255;
    const source = halfTexture(device, ...size, (x) =>
      x < 4 ? [0, 0, 0] : x >= 124 ? [1, 1, 1] : [grey, grey, grey],
    );
    const one = await finish(source, { grain: 8, grainSize: 1, frame: 1, dither: 0 }, size);
    const two = await finish(source, { grain: 8, grainSize: 1, frame: 2, dither: 0 }, size);
    let sum = 0;
    let squares = 0;
    let count = 0;
    let moved = 0;
    for (let y = 0; y < size[1]; y++) {
      for (let x = 0; x < size[0]; x++) {
        const i = (y * size[0] + x) * 4;
        if (x < 4) {
          expect(one[i]).toBe(0);
          continue;
        }
        if (x >= 124) {
          expect(one[i]).toBe(255);
          continue;
        }
        const d = one[i + 1]! - 128;
        sum += d;
        squares += d * d;
        count++;
        if (one[i + 1] !== two[i + 1]) moved++;
      }
    }
    const mean = sum / count;
    const deviation = Math.sqrt(squares / count - mean * mean);
    expect(Math.abs(mean)).toBeLessThan(0.15);
    expect(deviation).toBeGreaterThan(1);
    expect(deviation).toBeLessThan(8);
    expect(moved / count).toBeGreaterThan(0.5);
    source.destroy();
  });
});

describe('pixel bloom', () => {
  const SIZE = 64;

  /** The glow alone, decoded back to linear light and summed. */
  async function glowOf(
    scene: (x: number, y: number) => readonly number[],
    settings: Partial<PixelBloomSettings>,
  ): Promise<number> {
    const device = await getTestDevice();
    const source = halfTexture(device, SIZE, SIZE, scene);
    const target = device.createTexture({
      size: [SIZE, SIZE],
      format: 'rgba16float',
      usage: USAGE,
    });
    const bloom = createPixelBloom(device);
    const output = createOutputPass(device, { format: 'rgba16float' });
    bloom.resize(SIZE, SIZE);
    await expectValid(device, () => {
      const encoder = device.createCommandEncoder();
      const glow = bloom.encode(encoder, source.createView(), settings);
      output.encode(encoder, target.createView(), source.createView(), glow, {
        view: 'bloom',
        tonemap: 'none',
        dither: 0,
      });
      device.queue.submit([encoder.finish()]);
    });
    const values = await readHalf(device, target);
    let sum = 0;
    for (let i = 0; i < values.length; i += 4) {
      const v = Math.max(values[i]!, 0);
      sum += v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }
    bloom.destroy();
    output.destroy();
    source.destroy();
    target.destroy();
    return sum;
  }

  // A 2 x 2 lamp at 3, off the 2-texel grid so every box the stock chain averages is part dark.
  const lamp = (x: number, y: number) =>
    x >= 31 && x <= 32 && y >= 31 && y <= 32 ? [3, 2.4, 1] : [0.05, 0.05, 0.05];
  // A lit wall at 1.5: bright art, not a light.
  const wall = (x: number, y: number) =>
    x >= 10 && x < 30 && y >= 10 && y < 30 ? [1.5, 1.4, 1.2] : [0.05, 0.05, 0.05];
  const settings = {
    threshold: 2,
    knee: 0.25,
    intensity: 1,
    radius: 0.45,
    levels: 0,
    fireflyFilter: false,
  };

  it('keeps a small lamp’s glow that the averaged threshold loses', async () => {
    const texel = await glowOf(lamp, { ...settings, source: 'texel' });
    const average = await glowOf(lamp, { ...settings, source: 'average' });
    expect(texel).toBeGreaterThan(0);
    expect(texel).toBeGreaterThan(average * 1.5);
  });

  it('leaves lit art below the threshold alone', async () => {
    expect(await glowOf(wall, { ...settings, source: 'texel' })).toBe(0);
  });

  it('does no work at intensity 0', async () => {
    const device = await getTestDevice();
    const bloom = createPixelBloom(device);
    bloom.resize(1920, 1080);
    expect(bloom.levelCount(-1)).toBe(bloom.levelCount(0) - 1);
    bloom.resize(SIZE, SIZE);
    const encoder = device.createCommandEncoder();
    const scene = device.createTexture({ size: [SIZE, SIZE], format: 'rgba16float', usage: USAGE });
    expect(bloom.encode(encoder, scene.createView(), { intensity: 0 })).toBeUndefined();
    encoder.finish();
    bloom.destroy();
    scene.destroy();
  });
});

// The grade is on display-referred colour; DUSK_SQUARE is what the finishing effect runs.
it('the finishing effect’s grade is a real look', () => {
  expect(applyLooks(DUSK_SQUARE, [0.5, 0.5, 0.5])).not.toEqual([0.5, 0.5, 0.5]);
});
