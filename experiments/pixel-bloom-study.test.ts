import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, it, vi } from 'vitest';
import { poseCamera } from '../src/gpu/diorama/rig.ts';
import { createDioramaStage, loadSceneArt } from '../src/gpu/diorama/stage.ts';
import { createRenderTarget } from '../src/gpu/targets.ts';
import { VILLAGE_ART, villageScene } from '../src/effects/diorama/village.ts';
import { getTestDevice, readTexture } from '../tests/gpu.ts';
import { mountHeadless, writePng } from '../tests/headless.ts';

// Story 5.4: what makes bloom smear pixel art, and which settings stop it.
//
//   npx vitest run --silent=false --config experiments/vite.config.ts experiments/pixel-bloom-study.test.ts
//
// 1. Radiance. The village's HDR scene read back with the lanterns' glow on and off: the texels
//    that change are the glass (emissive); every other texel is lit art. Their brightest channels
//    say where a threshold has to sit to leave the art alone.
// 2. Smear against glow. The pixel-bloom effect at 960 x 540 with the camera still, for each
//    setting: the picture with bloom, without it, and without bloom or glow (to find the glass).
//    From the difference with and without bloom, in 8-bit steps of the brightest channel:
//    - glow: the mean change 1 to 4 px outside the glass, the halo you see;
//    - reach: how far out the ring mean stays at 2 steps or more;
//    - contrast kept: texel-to-texel contrast of the art within 24 px of the glass, with bloom over
//      without (1 is untouched; the glow washing over the lamp post and the cobbles lowers it);
//    - far change: the mean change more than 64 px from any glass, and the share of those pixels
//      moved by 2 steps or more. Nothing there is emissive, so any change is smear.

vi.setConfig({ testTimeout: 3_600_000 });

const OUT = 'output/pixel-bloom-study';
const WIDTH = 960;
const HEIGHT = 540;

function halfValue(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const mantissa = bits & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (mantissa / 1024);
  return sign * 2 ** (exponent - 15) * (1 + mantissa / 1024);
}

const DUSK = { sunElevation: 9, sunAzimuth: -1.2, sunIntensity: 0.9 };
const MIDDAY = { sunElevation: 50, sunAzimuth: 0.75, sunIntensity: 1.4 };

const percentile = (sorted: Float32Array, p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;

async function radiance(light: typeof DUSK) {
  const device = await getTestDevice();
  const scene = villageScene();
  const stage = createDioramaStage(device, {
    scene,
    art: await loadSceneArt(scene, VILLAGE_ART),
    colorFormat: 'rgba16float',
  });
  stage.resize(WIDTH, HEIGHT);
  const target = createRenderTarget(device, {
    label: 'study scene',
    format: 'rgba16float',
    width: WIDTH,
    height: HEIGHT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const aspect = WIDTH / HEIGHT;
  const fit = 27 / (2 * Math.tan((25 * Math.PI) / 360) * aspect);
  const camera = poseCamera(
    {
      ...scene.camera,
      focus: [10.8, 2.6, 8.8],
      distance: Math.max(scene.camera.distance, fit),
    },
    aspect,
    'perspective',
  );
  const render = async (glow: number) => {
    const encoder = device.createCommandEncoder();
    stage.encode(encoder, {
      camera,
      time: 0,
      target: target.view,
      settings: { ...light, glow, clear: [0.05, 0.06, 0.1] },
    });
    device.queue.submit([encoder.finish()]);
    const bits = new Uint16Array((await readTexture(device, target.texture, 8)).buffer);
    const peak = new Float32Array(WIDTH * HEIGHT);
    for (let i = 0; i < peak.length; i++) {
      peak[i] = Math.max(
        halfValue(bits[i * 4]!),
        halfValue(bits[i * 4 + 1]!),
        halfValue(bits[i * 4 + 2]!),
      );
    }
    return peak;
  };
  const on = await render(1);
  const off = await render(0);
  stage.destroy();
  target.destroy();
  const emissive: number[] = [];
  const lit: number[] = [];
  const mask = new Uint8Array(on.length);
  for (let i = 0; i < on.length; i++) {
    mask[i] = on[i]! - off[i]! > 0.25 ? 1 : 0;
    (mask[i] ? emissive : lit).push(on[i]!);
  }
  const e = Float32Array.from(emissive).sort();
  const l = Float32Array.from(lit).sort();
  const summary = {
    emissiveTexels: e.length,
    emissiveMin: +e[0]!.toFixed(2),
    emissiveMedian: +percentile(e, 0.5).toFixed(2),
    litP99: +percentile(l, 0.99).toFixed(2),
    litP999: +percentile(l, 0.999).toFixed(2),
    litMax: +l[l.length - 1]!.toFixed(2),
    litOver1: +(l.filter((v) => v > 1).length / l.length).toFixed(4),
    litOver1_5: +(l.filter((v) => v > 1.5).length / l.length).toFixed(4),
    litOver1_75: l.filter((v) => v > 1.75).length,
  };
  return { summary, mask };
}

/** The settings compared. `stock` is what createHdrTail runs; the lens effects use `lens`. */
const STOCK = {
  source: 'average',
  bloom: 0.6,
  bloomThreshold: 1,
  knee: 0.5,
  bloomRadius: 0.7,
  levels: 0,
  fireflyFilter: true,
};
const PIXEL = {
  source: 'texel',
  bloom: 0.8,
  bloomThreshold: 2,
  knee: 0.25,
  bloomRadius: 0.45,
  levels: -1,
  fireflyFilter: false,
};
const CONFIGS: Record<string, Record<string, unknown>> = {
  'stock tail (average, thr 1)': STOCK,
  'lens effects (average, thr 1.5, r .55)': {
    ...STOCK,
    bloom: 0.5,
    bloomThreshold: 1.5,
    bloomRadius: 0.55,
  },
  'low threshold (average, thr 0.6)': { ...STOCK, bloom: 0.8, bloomThreshold: 0.6 },
  'average, thr 2, firefly on': { ...PIXEL, source: 'average', fireflyFilter: true },
  'average, thr 2, firefly off': { ...PIXEL, source: 'average' },
  'average, thr 2, intensity 2.4': { ...PIXEL, source: 'average', bloom: 2.4 },
  'texel, thr 2 (pixel bloom)': PIXEL,
  'texel, thr 2, firefly on': { ...PIXEL, fireflyFilter: true },
  'texel, thr 1': { ...PIXEL, bloomThreshold: 1, knee: 0.5 },
  'texel, thr 2, levels auto, r .7': { ...PIXEL, levels: 0, bloomRadius: 0.7 },
  'texel, thr 2, levels -2': { ...PIXEL, levels: -2 },
};

/** Exact Euclidean distance to the nearest mask pixel, brute force over the mask's pixels. */
function distanceTo(mask: Uint8Array, width: number, height: number): Float32Array {
  const points: number[] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) points.push(i % width, Math.floor(i / width));
  const distance = new Float32Array(mask.length).fill(Infinity);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let best = Infinity;
      for (let k = 0; k < points.length; k += 2) {
        const dx = points[k]! - x;
        const dy = points[k + 1]! - y;
        const d = dx * dx + dy * dy;
        if (d < best) best = d;
      }
      distance[y * width + x] = Math.sqrt(best);
    }
  }
  return distance;
}

const peakOf = (rgba: Uint8Array, i: number) =>
  Math.max(rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!);
const lumaOf = (rgba: Uint8Array, i: number) =>
  0.2126 * rgba[i * 4]! + 0.7152 * rgba[i * 4 + 1]! + 0.0722 * rgba[i * 4 + 2]!;

async function frameOf(params: Record<string, unknown>): Promise<Uint8Array> {
  const mounted = await mountHeadless('pixel-bloom', {
    width: WIDTH,
    height: HEIGHT,
    params: { sway: 0, ...params },
  });
  mounted.step();
  const pixels = await mounted.read();
  mounted.destroy();
  return pixels;
}

function measure(
  withBloom: Uint8Array,
  without: Uint8Array,
  mask: Uint8Array,
  distance: Float32Array,
) {
  const rings = new Float64Array(200);
  const counts = new Float64Array(200);
  let near = 0;
  let nearCount = 0;
  let far = 0;
  let farCount = 0;
  let farMoved = 0;
  let contrastWith = 0;
  let contrastWithout = 0;
  for (let y = 0; y < HEIGHT - 1; y++) {
    for (let x = 0; x < WIDTH - 1; x++) {
      const i = y * WIDTH + x;
      if (mask[i]) continue;
      const d = distance[i]!;
      const delta = Math.abs(peakOf(withBloom, i) - peakOf(without, i));
      const ring = Math.floor(d);
      if (ring < rings.length) {
        rings[ring]! += delta;
        counts[ring]! += 1;
      }
      if (d >= 1 && d <= 4) {
        near += delta;
        nearCount++;
      }
      if (d > 64) {
        far += delta;
        farCount++;
        if (delta >= 2) farMoved++;
      }
      if (d <= 24 && !mask[i + 1] && !mask[i + WIDTH]) {
        const c = (image: Uint8Array) =>
          Math.abs(lumaOf(image, i + 1) - lumaOf(image, i)) +
          Math.abs(lumaOf(image, i + WIDTH) - lumaOf(image, i));
        contrastWith += c(withBloom);
        contrastWithout += c(without);
      }
    }
  }
  let reach = 0;
  for (let r = 1; r < rings.length; r++) {
    if (counts[r]! > 0 && rings[r]! / counts[r]! >= 2) reach = r;
    else if (r > 1) break;
  }
  return {
    glow: +(near / Math.max(nearCount, 1)).toFixed(2),
    reachPx: reach,
    contrastKept: +(contrastWith / Math.max(contrastWithout, 1)).toFixed(3),
    farChange: +(far / Math.max(farCount, 1)).toFixed(3),
    farMovedShare: +(farMoved / Math.max(farCount, 1)).toFixed(4),
  };
}

describe('pixel bloom study', () => {
  it('measures radiance, smear and glow', async () => {
    mkdirSync(OUT, { recursive: true });
    const results: Record<string, unknown> = {};
    const radiances = { dusk: await radiance(DUSK), midday: await radiance(MIDDAY) };
    results.radiance = { dusk: radiances.dusk.summary, midday: radiances.midday.summary };
    console.log(JSON.stringify(results.radiance, null, 2));

    for (const [lightName, light] of Object.entries({ dusk: DUSK, midday: MIDDAY })) {
      const without = await frameOf({ ...light, bloom: 0 });
      // The glass: the texels the glow changes in the HDR scene, drawn from the same camera.
      const { mask } = radiances[lightName as keyof typeof radiances];
      const distance = distanceTo(mask, WIDTH, HEIGHT);
      const rows: Record<string, unknown> = {
        'glass pixels': mask.reduce((a, b) => a + b, 0),
      };
      for (const [name, config] of Object.entries(CONFIGS)) {
        const picture = await frameOf({ ...light, ...config });
        rows[name] = measure(picture, without, mask, distance);
        console.log(lightName, name, JSON.stringify(rows[name]));
        // A crop around the lanterns, four times enlarged, for looking at.
        const [cx, cy, cw, ch] = [380, 150, 200, 120];
        const crop = new Uint8Array(cw * ch * 3 * 16);
        for (let y = 0; y < ch * 4; y++) {
          for (let x = 0; x < cw * 4; x++) {
            const i = ((cy + (y >> 2)) * WIDTH + cx + (x >> 2)) * 4;
            crop.set(picture.subarray(i, i + 3), (y * cw * 4 + x) * 3);
          }
        }
        const file = name.replace(/[^\w]+/g, '-').replace(/-+$/, '');
        writePng(`${OUT}/${lightName}-${file}.png`, cw * 4, ch * 4, crop);
      }
      results[lightName] = rows;
    }
    writeFileSync('experiments/pixel-bloom-results.json', `${JSON.stringify(results, null, 2)}\n`);
  });
});
