import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { describe, it, vi } from 'vitest';
import { mat4, vec3 } from 'wgpu-matrix';
import {
  CAMERA_DISTANCE,
  createStandInScene,
  standInCamera,
} from './tilt-shift-street.ts';
import {
  cocFromDistance,
  cocFromRow,
  createTiltShift,
  DEFAULT_TILT_SHIFT,
  maxRadiusPixels,
  type TiltShiftSettings,
  type TiltShiftView,
} from '../src/gpu/lens/tilt-shift.ts';
import { createSceneTargets } from '../src/gpu/sprites/targets.ts';
import { createRenderTarget } from '../src/gpu/targets.ts';
import { createBenchDevice } from '../tests/bench.ts';
import { readTexture } from '../tests/gpu.ts';

// Story 5.1's comparison: the depth lens against the screen lens on a deep street of sprites
// (tilt-shift-street.ts). Which should be the default, and which the Tier A fallback?
//
//   npx vitest run --silent=false --config experiments/vite.config.ts experiments/tilt-shift-study.test.ts
//
// 1. Where the screen method blurs the wrong things. The depth lens's own prefilter is used as a
//    depth probe (focus at 0, no band, one long linear ramp, so a block's circle is proportional to
//    its nearest distance), which gives each half-resolution block's view distance. From it, on the
//    CPU, the depth method's circle (`cocFromDistance`) and the screen method's (`cocFromRow`) for
//    the same block. Blocks are split into ground and upright (sprites and sky) by comparing the
//    distance with the ground plane's along that pixel's ray. With no camera roll, the ground's
//    view distance is a function of the row alone, so the screen method can match it on the
//    ground; the question is how wrong it is on everything standing up. The screen settings are
//    the effect's defaults and, separately, fitted to the ground's rows by a grid search.
// 2. What each costs: the lens alone at 1920 x 1080 on Dawn with timestamp queries (bench.ts), and
//    the scene plus the lens. On a shared GPU these numbers are noisy; the study harness is what
//    the scorecard quotes.
// 3. Pictures of both, and of the inspector's views, in output/tilt-shift-study/.

vi.setConfig({ testTimeout: 3_600_000 });

const OUT = 'output/tilt-shift-study';
const SETTINGS: TiltShiftSettings = {
  ...DEFAULT_TILT_SHIFT,
  focusDistance: CAMERA_DISTANCE,
  focusBand: 3,
  nearTransition: 5,
  farTransition: 10,
  maxBlur: 0.015,
};

/** Linear HDR rgba16float bytes to an sRGB PNG, clamped. */
function writePng(path: string, half: Uint16Array, width: number, height: number) {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) {
      const v = Math.min(Math.max(halfToFloat(half[i * 4 + c]!), 0), 1);
      const s = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
      png.data[i * 4 + c] = Math.round(s * 255);
    }
    png.data[i * 4 + 3] = 255;
  }
  writeFileSync(path, PNG.sync.write(png));
}

function halfToFloat(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

describe('tilt-shift study', () => {
  it('compares the depth and screen lenses', async () => {
    mkdirSync(OUT, { recursive: true });
    const bench = await createBenchDevice();
    const { device } = bench;
    const results: Record<string, unknown> = {
      note: 'Timings taken while other agents shared the GPU; treat them as indicative only.',
      timing: bench.timed ? 'gpu-timestamp' : 'cpu-wall',
    };

    const scene = await createStandInScene(device, { colorFormat: 'rgba16float', label: 'study' });
    const targets = createSceneTargets(device, { colorFormat: 'rgba16float' });
    targets.setSampleCount(4);
    const sharp = createRenderTarget(device, {
      label: 'study sharp',
      format: 'rgba16float',
      width: 1,
      height: 1,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });
    const out = createRenderTarget(device, {
      label: 'study out',
      format: 'rgba16float',
      width: 1,
      height: 1,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const lens = createTiltShift(device, { label: 'study' });

    const setSize = (width: number, height: number) => {
      targets.resize(width, height);
      sharp.resize(width, height);
      out.resize(width, height);
      lens.resize(width, height);
      return standInCamera(width / height);
    };
    const drawScene = (encoder: GPUCommandEncoder, camera: ReturnType<typeof standInCamera>) => {
      const pass = encoder.beginRenderPass(
        targets.pass(sharp.view, [0.05, 0.06, 0.11, 1], bench.profiler.pass('scene')),
      );
      scene.draw(pass, camera, { time: 0, sampleCount: 4, glow: 6 });
      pass.end();
    };
    const runLens = (
      encoder: GPUCommandEncoder,
      camera: ReturnType<typeof standInCamera>,
      settings: TiltShiftSettings,
    ) =>
      lens.encode(
        encoder,
        { color: sharp.view, depth: targets.depth, projection: camera.projection },
        out.view,
        settings,
        bench.profiler,
      );

    // ---- 1. where the screen method goes wrong, at 960 x 540 --------------------------------
    {
      const width = 960;
      const height = 540;
      const camera = setSize(width, height);
      // The probe: circle = 48 * distance / 200 pixels (the cap is 48; the far plane is 150).
      const probe: TiltShiftSettings = {
        ...SETTINGS,
        focusDistance: 0,
        focusBand: 0,
        farTransition: 200,
        maxBlur: 1,
      };
      const encoder = device.createCommandEncoder();
      drawScene(encoder, camera);
      runLens(encoder, camera, probe);
      device.queue.submit([encoder.finish()]);
      const halfWidth = lens.prefiltered.width;
      const halfHeight = lens.prefiltered.height;
      const data = new Uint16Array((await readTexture(device, lens.prefiltered.texture, 8)).buffer);
      const distance = (i: number) => (halfToFloat(data[i * 4 + 3]!) * 200) / 48;

      // The ground plane's view distance along the ray through each half-resolution block's centre.
      const inverse = mat4.inverse(camera.viewProj);
      const invert = (x: number, y: number, z: number) => {
        const ndc = [(x / width) * 2 - 1, 1 - (y / height) * 2, z, 1];
        const m = inverse;
        const p = [0, 1, 2, 3].map((r) => ndc.reduce((s, v, c) => s + m[c * 4 + r]! * v, 0));
        return [p[0]! / p[3]!, p[1]! / p[3]!, p[2]! / p[3]!] as const;
      };
      const groundDistance = (x: number, y: number) => {
        const a = invert(x, y, 0);
        const b = invert(x, y, 1);
        const t = a[1] / (a[1] - b[1]);
        if (!(t > 0)) return Infinity;
        const hit = vec3.lerp(a, b, t);
        return vec3.dot(vec3.subtract(hit, camera.eye), camera.forward);
      };

      const blocks: { row: number; z: number; ground: boolean; y: number }[] = [];
      for (let j = 0; j < halfHeight; j++) {
        for (let i = 0; i < halfWidth; i++) {
          const x = i * 2 + 1;
          const y = j * 2 + 1;
          const z = distance(j * halfWidth + i);
          const g = groundDistance(x, y);
          blocks.push({ row: j, y, z, ground: Math.abs(z - g) < 0.4 });
        }
      }
      // The ground's circle by row (the median over the row's ground blocks).
      const rowCoc: (number | undefined)[] = [];
      for (let j = 0; j < halfHeight; j++) {
        const cocs = blocks
          .filter((b) => b.row === j && b.ground)
          .map((b) => cocFromDistance(b.z, SETTINGS, height))
          .sort((a, b) => a - b);
        rowCoc.push(cocs.length ? cocs[Math.floor(cocs.length / 2)] : undefined);
      }

      const score = (screen: Pick<TiltShiftSettings, 'line' | 'lineBand' | 'lineTransition'>) => {
        const s = { ...SETTINGS, ...screen };
        const tally = (subset: typeof blocks) => {
          let error = 0;
          let wrong = 0;
          let sharpBlurred = 0;
          let sharpCount = 0;
          let blurredSharp = 0;
          let blurredCount = 0;
          for (const b of subset) {
            const truth = cocFromDistance(b.z, SETTINGS, height);
            const guess = cocFromRow(b.y, s, height);
            const d = Math.abs(Math.abs(truth) - Math.abs(guess));
            error += d;
            if (d > 2) wrong++;
            if (Math.abs(truth) < 1) {
              sharpCount++;
              if (Math.abs(guess) > 2) sharpBlurred++;
            }
            if (Math.abs(truth) > 4) {
              blurredCount++;
              if (Math.abs(guess) < 1) blurredSharp++;
            }
          }
          return {
            blocks: subset.length,
            meanErrorPx: +(error / subset.length).toFixed(2),
            wrongBy2px: +(wrong / subset.length).toFixed(3),
            inFocusButBlurred: +(sharpBlurred / Math.max(sharpCount, 1)).toFixed(3),
            blurredButSharp: +(blurredSharp / Math.max(blurredCount, 1)).toFixed(3),
          };
        };
        return {
          ...screen,
          ground: tally(blocks.filter((b) => b.ground)),
          upright: tally(blocks.filter((b) => !b.ground && b.z < 140)),
        };
      };

      // Fit the screen method to the ground's rows.
      let best = { line: 0.5, lineBand: 0.06, lineTransition: 0.3 };
      let bestError = Infinity;
      for (let line = 0.3; line <= 0.7001; line += 0.01) {
        for (let band = 0; band <= 0.2001; band += 0.01) {
          for (let transition = 0.05; transition <= 0.8001; transition += 0.025) {
            const s = { ...SETTINGS, line, lineBand: band, lineTransition: transition };
            let error = 0;
            rowCoc.forEach((c, j) => {
              if (c !== undefined) error += Math.abs(c - cocFromRow(j * 2 + 1, s, height));
            });
            if (error < bestError) {
              bestError = error;
              best = {
                line: +line.toFixed(2),
                lineBand: +band.toFixed(2),
                lineTransition: +transition.toFixed(3),
              };
            }
          }
        }
      }
      // The best one screen setting can do for the whole picture, ground and uprights together, on
      // a coarser grid over a sample of blocks.
      const sample = blocks.filter((b, i) => b.z < 140 && i % 7 === 0);
      let overall = best;
      let overallError = Infinity;
      for (let line = 0.3; line <= 0.7001; line += 0.02) {
        for (let band = 0; band <= 0.2001; band += 0.02) {
          for (let transition = 0.05; transition <= 0.8001; transition += 0.05) {
            const s = { ...SETTINGS, line, lineBand: band, lineTransition: transition };
            let error = 0;
            for (const b of sample) {
              error += Math.abs(
                cocFromDistance(b.z, SETTINGS, height) - cocFromRow(b.y, s, height),
              );
            }
            if (error < overallError) {
              overallError = error;
              overall = {
                line: +line.toFixed(2),
                lineBand: +band.toFixed(2),
                lineTransition: +transition.toFixed(3),
              };
            }
          }
        }
      }
      results.maxBlurPx = maxRadiusPixels(SETTINGS, height);
      results.agreement = {
        size: `${width}x${height}`,
        depthSettings: SETTINGS,
        defaults: score(SETTINGS),
        fittedToGround: score(best),
        fittedToAll: score(overall),
      };
      console.log(JSON.stringify(results.agreement, null, 2));

      // Pictures.
      const shoot = async (name: string, settings: TiltShiftSettings | undefined) => {
        const enc = device.createCommandEncoder();
        drawScene(enc, camera);
        if (settings) runLens(enc, camera, settings);
        device.queue.submit([enc.finish()]);
        const texture = settings ? out.texture : sharp.texture;
        writePng(
          `${OUT}/${name}.png`,
          new Uint16Array((await readTexture(device, texture, 8)).buffer),
          width,
          height,
        );
      };
      await shoot('sharp', undefined);
      await shoot('depth', SETTINGS);
      await shoot('screen', { ...SETTINGS, method: 'screen' });
      await shoot('screen-fitted', { ...SETTINGS, ...best, method: 'screen' });
      await shoot('screen-fitted-all', { ...SETTINGS, ...overall, method: 'screen' });
      for (const view of ['coc', 'near', 'far'] as TiltShiftView[]) {
        await shoot(`depth-${view}`, { ...SETTINGS, view });
        await shoot(`screen-${view}`, { ...SETTINGS, method: 'screen', view });
      }
    }

    // ---- 2. cost at 1920 x 1080 --------------------------------------------------------------
    {
      const camera = setSize(1920, 1080);
      const cost: Record<string, unknown> = {};
      const prime = device.createCommandEncoder();
      drawScene(prime, camera);
      device.queue.submit([prime.finish()]);
      for (const method of ['depth', 'screen'] as const) {
        const settings = { ...SETTINGS, method };
        const alone = await bench.measure((encoder) => runLens(encoder, camera, settings));
        const withScene = await bench.measure((encoder) => {
          drawScene(encoder, camera);
          runLens(encoder, camera, settings);
        });
        cost[method] = {
          lensMs: +alone.slopeMs.toFixed(3),
          lensRangeMs: [+alone.slopeMinMs.toFixed(3), +alone.slopeMaxMs.toFixed(3)],
          sceneAndLensMs: +withScene.slopeMs.toFixed(3),
          passes: alone.passes,
        };
      }
      cost.sceneOnlyMs = +(
        await bench.measure((encoder) => drawScene(encoder, camera))
      ).slopeMs.toFixed(3);
      results.cost1080p = cost;
      console.log(JSON.stringify(cost, null, 2));
    }

    writeFileSync('experiments/tilt-shift-results.json', `${JSON.stringify(results, null, 2)}\n`);
    lens.destroy();
    out.destroy();
    sharp.destroy();
    targets.destroy();
    scene.destroy();
    bench.destroy();
  });
});
