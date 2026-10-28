/*
 * Colour grading by 3D lookup table (story 5.7): looks described by a few parameters, baked on the
 * CPU into 32³ tables, and a pair of tables on the GPU that crossfade from one look to the next.
 *
 *   const grade = createGradeLuts(device, { look: DUSK });
 *   frame:  grade.show(`${time}/${area}`, [TIMES[time], AREAS[area]], 1.5);  // no-op if unchanged
 *           grade.update(time.delta);
 *           tail.encode(..., { grade: grade.input });                         // finishing.ts reads it
 *
 * Where the grade sits: after the tonemap, on display-referred colour, sRGB-encoded, in [0, 1].
 * That domain is bounded, so 32 steps per axis cover it evenly (tests/grade.test.ts measures a
 * 32³ table against the exact look), and it is where a look painted over a screenshot applies
 * unchanged. The same table indexed by scene-linear radiance would need a shaper curve and a
 * chosen ceiling, and puts most of its cells in highlights nobody can tell apart. The bloom is in
 * the picture by then, so a dusk grade warms the lamps' glow along with the lamps.
 *
 * A look's colour work is done in OKLab (Ottosson 2020), so contrast and saturation move
 * lightness and chroma without shifting hue, and the split tones are offsets in its a/b plane.
 *
 * Built here rather than in @mk7s/hologpu-temple-core, which this repo cannot publish; nothing in
 * it is specific to pixel art, so it is meant to move upstream next to gpu/post/output.
 */
import { linearToOklab, linearToSrgb, srgbToLinear } from '../palette/oklab.ts';

/** Cells along each axis of a grade table: 32³ is 256 kB as rgba16float. */
export const GRADE_LUT_SIZE = 32;
export const GRADE_LUT_FORMAT: GPUTextureFormat = 'rgba16float';

export type Rgb = readonly [number, number, number];

/** One look. Every field is optional; a look with none of them changes nothing. */
export interface GradeLook {
  /** Stops of exposure on display-linear light. 0 is unchanged. */
  exposure?: number;
  /** White balance, -1 (cool) to 1 (warm). */
  temperature?: number;
  /** -1 (green) to 1 (magenta). */
  tint?: number;
  /** OKLab lightness contrast about `pivot`; 1 is unchanged. */
  contrast?: number;
  /** Lightness the contrast turns about. Default 0.55, about mid grey. */
  pivot?: number;
  /** Lifts black towards this lightness (a faded print), 0..0.3. */
  fade?: number;
  /** Chroma multiplier; 1 is unchanged, 0 is grey. */
  saturation?: number;
  /** Split toning: shadows pushed toward `shadows`, highlights toward `highlights` (linear RGB). */
  shadows?: Rgb;
  shadowAmount?: number;
  highlights?: Rgb;
  highlightAmount?: number;
}

export const IDENTITY_LOOK: Readonly<GradeLook> = {};

const isNeutral = (look: GradeLook) =>
  !look.exposure &&
  !look.temperature &&
  !look.tint &&
  (look.contrast ?? 1) === 1 &&
  !look.fade &&
  (look.saturation ?? 1) === 1 &&
  !look.shadowAmount &&
  !look.highlightAmount;

const smoothstep = (lo: number, hi: number, x: number) => {
  const t = Math.min(Math.max((x - lo) / (hi - lo), 0), 1);
  return t * t * (3 - 2 * t);
};

/** The direction of a colour in OKLab's a/b plane, scaled so a fully saturated hue is about 1. */
function toneOffset(colour: Rgb | undefined, amount: number): [number, number] {
  if (!colour || !amount) return [0, 0];
  const [, a, b] = linearToOklab(colour);
  const chroma = Math.hypot(a, b);
  if (chroma < 1e-6) return [0, 0];
  // 0.1 of OKLab chroma at amount 1: a strong, but not garish, tone.
  return [(a / chroma) * 0.1 * amount, (b / chroma) * 0.1 * amount];
}

// The transfer functions as tables with linear interpolation: building a table calls them six
// times a cell per look, and the exact curves (a pow each) were most of the time. 4096 steps keep
// the error under a hundredth of an 8-bit step.
const CURVE_STEPS = 4096;
const DECODE = Float64Array.from({ length: CURVE_STEPS + 1 }, (_, i) =>
  srgbToLinear(i / CURVE_STEPS),
);
const ENCODE = Float64Array.from({ length: CURVE_STEPS + 1 }, (_, i) =>
  linearToSrgb(i / CURVE_STEPS),
);
const curve = (table: Float64Array, x: number) => {
  const p = Math.min(Math.max(x, 0), 1) * CURVE_STEPS;
  const i = Math.min(Math.floor(p), CURVE_STEPS - 1);
  return table[i]! + (table[i + 1]! - table[i]!) * (p - i);
};

/** A look turned into a function on one colour, in place: everything per look is worked out once. */
type CompiledLook = (rgb: number[]) => void;

function compileLook(look: GradeLook): CompiledLook | undefined {
  if (isNeutral(look)) return undefined;
  // Exposure and white balance as channel gains, normalised so white keeps its luminance.
  const gain = 2 ** (look.exposure ?? 0);
  const t = (look.temperature ?? 0) * 0.18;
  const g = (look.tint ?? 0) * 0.12;
  const luma = 0.2126 * (1 + t) + 0.7152 * (1 - g) + 0.0722 * (1 - t);
  const kr = (gain * (1 + t)) / luma;
  const kg = (gain * (1 - g)) / luma;
  const kb = (gain * (1 - t)) / luma;
  const pivot = look.pivot ?? 0.55;
  const contrast = look.contrast ?? 1;
  const fade = look.fade ?? 0;
  const saturation = look.saturation ?? 1;
  const [sa, sb] = toneOffset(look.shadows, look.shadowAmount ?? 0);
  const [ha, hb] = toneOffset(look.highlights, look.highlightAmount ?? 0);

  return (rgb) => {
    const r = curve(DECODE, rgb[0]!) * kr;
    const gl = curve(DECODE, rgb[1]!) * kg;
    const bl = curve(DECODE, rgb[2]!) * kb;
    // To OKLab (oklab.ts, inlined: this runs 32 768 times per look).
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * gl + 0.0514459929 * bl);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * gl + 0.1073969566 * bl);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * gl + 0.6299787005 * bl);
    let L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    let A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    let B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

    L = pivot + (L - pivot) * contrast;
    L = fade + Math.max(L, 0) * (1 - fade);
    const low = 1 - smoothstep(0.05, 0.65, L);
    const high = smoothstep(0.45, 1, L);
    A = A * saturation + sa * low + ha * high;
    B = B * saturation + sb * low + hb * high;

    // Out-of-gamut results are clipped per channel. That puts a crease in the look where a channel
    // reaches 0 or 1, which the table interpolates across (tests/post-fx.test.ts measures it);
    // giving up chroma at constant lightness instead was tried and is worse, turning bright
    // yellows white.
    const lc = L + 0.3963377774 * A + 0.2158037573 * B;
    const mc = L - 0.1055613458 * A - 0.0638541728 * B;
    const sc = L - 0.0894841775 * A - 1.291485548 * B;
    const l3 = lc * lc * lc;
    const m3 = mc * mc * mc;
    const s3 = sc * sc * sc;
    rgb[0] = curve(ENCODE, 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3);
    rgb[1] = curve(ENCODE, -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3);
    rgb[2] = curve(ENCODE, -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3);
  };
}

/** One look applied to one display colour (sRGB-encoded, 0..1); the result is clamped to 0..1. */
export function applyLook(look: GradeLook, srgb: Rgb): [number, number, number] {
  return applyLooks([look], srgb);
}

/** Looks applied in order: `[timeOfDay, area]` grades the area on top of the time of day. */
export function applyLooks(looks: readonly GradeLook[], srgb: Rgb): [number, number, number] {
  const c = [srgb[0], srgb[1], srgb[2]];
  for (const look of looks) compileLook(look)?.(c);
  return c as [number, number, number];
}

/**
 * The table for a chain of looks: RGBA floats, red fastest, then green, then blue (a 3D texture's
 * row and slice order). Cell (r, g, b) holds the graded colour of (r, g, b) / (size - 1).
 */
export function buildGradeLut(looks: readonly GradeLook[], size = GRADE_LUT_SIZE): Float32Array {
  const data = new Float32Array(size * size * size * 4);
  const compiled = looks.map(compileLook).filter((look) => look !== undefined);
  const step = 1 / (size - 1);
  const c = [0, 0, 0];
  let i = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        c[0] = r * step;
        c[1] = g * step;
        c[2] = b * step;
        for (const look of compiled) look(c);
        data[i++] = c[0];
        data[i++] = c[1];
        data[i++] = c[2];
        data[i++] = 1;
      }
    }
  }
  return data;
}

/**
 * Reads a table the way the GPU does (trilinear, cell centres at (i + 0.5) / size after the
 * `(size - 1) / size` scale): the CPU twin of `finish_grade` in finishing.wgsl.
 */
export function sampleGradeLut(lut: Float32Array, srgb: Rgb, size = GRADE_LUT_SIZE): Rgb {
  const at = (r: number, g: number, b: number, c: number) =>
    lut[((b * size + g) * size + r) * 4 + c]!;
  const p = srgb.map((v) => Math.min(Math.max(v, 0), 1) * (size - 1));
  const i0 = p.map((v) => Math.min(Math.floor(v), size - 2));
  const f = p.map((v, k) => v - i0[k]!);
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    let sum = 0;
    for (let corner = 0; corner < 8; corner++) {
      const dr = corner & 1;
      const dg = (corner >> 1) & 1;
      const db = corner >> 2;
      const w = (dr ? f[0]! : 1 - f[0]!) * (dg ? f[1]! : 1 - f[1]!) * (db ? f[2]! : 1 - f[2]!);
      sum += w * at(i0[0]! + dr, i0[1]! + dg, i0[2]! + db, c);
    }
    out[c] = sum;
  }
  return out as unknown as Rgb;
}

/** `a` towards `b` by `t`, into `out` (which may be `a`). */
export function mixLuts(a: Float32Array, b: Float32Array, t: number, out = a): Float32Array {
  for (let i = 0; i < a.length; i++) out[i] = a[i]! + (b[i]! - a[i]!) * t;
  return out;
}

/** Float to IEEE half, round to nearest even, with subnormals (rgba16float has no typed array). */
export function toHalf(value: number): number {
  const f = new Float32Array([value]);
  const x = new Uint32Array(f.buffer)[0]!;
  const sign = (x >>> 16) & 0x8000;
  const exponent = (x >>> 23) & 0xff;
  let mantissa = x & 0x7fffff;
  if (exponent === 0xff) return sign | 0x7c00 | (mantissa ? 0x200 : 0);
  const e = exponent - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    mantissa |= 0x800000;
    const shift = 14 - e;
    const half = mantissa >>> shift;
    const rest = mantissa & ((1 << shift) - 1);
    const mid = 1 << (shift - 1);
    return sign | (half + (rest > mid || (rest === mid && half & 1) ? 1 : 0));
  }
  const half = (e << 10) | (mantissa >>> 13);
  const rest = mantissa & 0x1fff;
  return sign | (half + (rest > 0x1000 || (rest === 0x1000 && half & 1) ? 1 : 0));
}

function toHalves(data: Float32Array): Uint16Array<ArrayBuffer> {
  const out = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = toHalf(data[i]!);
  return out;
}

export function createGradeLutTexture(
  device: GPUDevice,
  label = 'grade lut',
  size = GRADE_LUT_SIZE,
) {
  return device.createTexture({
    label,
    size: [size, size, size],
    dimension: '3d',
    format: GRADE_LUT_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
}

export function writeGradeLut(device: GPUDevice, texture: GPUTexture, data: Float32Array): void {
  const size = texture.width;
  device.queue.writeTexture(
    { texture },
    toHalves(data),
    { bytesPerRow: size * 8, rowsPerImage: size },
    [size, size, size],
  );
}

/** What the finishing pass grades with: `from` and `to` mixed by `mix` (0 is all `from`). */
export interface GradeInput {
  readonly from: GPUTextureView;
  readonly to: GPUTextureView;
  readonly mix: number;
  /** Cells per axis. Default `GRADE_LUT_SIZE`. */
  readonly size?: number;
}

export interface GradeLutsOptions {
  /** What is shown before the first `show`. Default: no change. */
  looks?: readonly GradeLook[];
  key?: string;
  size?: number;
  label?: string;
}

export interface GradeLuts {
  /** The key of the look being shown or faded to. */
  readonly key: string;
  /** How far the current crossfade has got, 0..1 (1 when nothing is fading). */
  readonly mix: number;
  readonly input: GradeInput;
  /**
   * Fades to `looks`, called `key`, over `seconds` (0 cuts). Asking for the key already shown or
   * being faded to does nothing, so it can be called every frame. A new key mid-fade starts from
   * the picture on screen, not from either end, so there is no jump.
   */
  show(key: string, looks: readonly GradeLook[], seconds: number): void;
  update(delta: number): void;
  destroy(): void;
}

/** Two tables and a crossfade between them. Tables are cached by key (a few looks, 512 kB each). */
export function createGradeLuts(device: GPUDevice, options: GradeLutsOptions = {}): GradeLuts {
  const size = options.size ?? GRADE_LUT_SIZE;
  const label = options.label ?? 'grade';
  const cache = new Map<string, Float32Array>();
  const tableFor = (key: string, looks: readonly GradeLook[]) => {
    let table = cache.get(key);
    if (!table) {
      table = buildGradeLut(looks, size);
      cache.set(key, table);
    }
    return table;
  };
  let key = options.key ?? 'initial';
  let fromData = Float32Array.from(tableFor(key, options.looks ?? []));
  let toData = tableFor(key, options.looks ?? []);
  let fromTexture = createGradeLutTexture(device, `${label} a`, size);
  let toTexture = createGradeLutTexture(device, `${label} b`, size);
  writeGradeLut(device, fromTexture, fromData);
  writeGradeLut(device, toTexture, toData);
  let fromView = fromTexture.createView();
  let toView = toTexture.createView();
  let mix = 1;
  let duration = 0;

  return {
    get key() {
      return key;
    },
    get mix() {
      return mix;
    },
    get input() {
      return { from: fromView, to: toView, mix, size };
    },
    show(next, looks, seconds) {
      if (next === key) return;
      if (mix >= 1) {
        // Nothing fading: what is on screen is `to`, which becomes the new `from`.
        [fromTexture, toTexture] = [toTexture, fromTexture];
        [fromView, toView] = [toView, fromView];
        fromData = Float32Array.from(toData);
      } else if (mix > 0) {
        // Mid-fade: bake the blend on screen into `from`.
        mixLuts(fromData, toData, mix);
        writeGradeLut(device, fromTexture, fromData);
      }
      key = next;
      toData = tableFor(next, looks);
      writeGradeLut(device, toTexture, toData);
      duration = Math.max(seconds, 0);
      mix = duration > 0 ? 0 : 1;
    },
    update(delta) {
      if (mix < 1) mix = duration > 0 ? Math.min(1, mix + delta / duration) : 1;
    },
    destroy() {
      fromTexture.destroy();
      toTexture.destroy();
      cache.clear();
    },
  };
}

/** A region of a scene's ground plane with a look of its own. */
export interface GradeArea {
  name: string;
  /** World x and z bounds, inclusive. */
  min: readonly [number, number];
  max: readonly [number, number];
}

/**
 * The area a point on the ground is in. The current area is kept until the point is `margin`
 * outside it, so a camera resting on a border does not flicker between two looks. Outside every
 * area, the current one (or the first) is kept.
 */
export function areaAt(
  areas: readonly GradeArea[],
  x: number,
  z: number,
  current?: string,
  margin = 0.75,
): string {
  const inside = (area: GradeArea, pad: number) =>
    x >= area.min[0] - pad &&
    x <= area.max[0] + pad &&
    z >= area.min[1] - pad &&
    z <= area.max[1] + pad;
  const held = areas.find((area) => area.name === current);
  if (held && inside(held, margin)) return held.name;
  return areas.find((area) => inside(area, 0))?.name ?? held?.name ?? areas[0]?.name ?? '';
}
