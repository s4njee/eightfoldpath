import { writeFileSync } from 'node:fs';
import { describe, it, vi } from 'vitest';
import { mountHeadless } from '../tests/headless.ts';
import {
  boxDownLuma,
  edgeContrast,
  luma,
  Means,
  meanAbsDiff,
  popping,
  rows,
} from './texel-metrics.ts';

// Story 3.1's measurement: the texel-sampling scene under a slow pan, rendered per sampling mode,
// with and without mipmaps, at four device pixel ratios, against a 4 × 4 supersampled reference.
//
//   npx vitest run --silent=false --config experiments/vite.config.ts experiments/texel-sampling-study.test.ts
//
// Writes experiments/texel-sampling-results.json and prints a table. The numbers in
// src/effects/texel-sampling/notes.md come from here.

vi.setConfig({ testTimeout: 3_600_000 });

/** A CSS box of 320 × 180, as a canvas at each ratio. */
const CSS = [320, 180] as const;
const RATIOS = [1, 1.5, 2, 3];
const MODES = ['nearest', 'bilinear', 'sharp'] as const;
const FRAMES = 40;
const SUPERSAMPLE = 4;
const SCENES: Record<string, Record<string, unknown>> = {
  default: { motion: 'pan', speed: 0.3 },
  'far ground': { motion: 'pan', speed: 0.3, pitch: 20, framing: 16 },
  orbit: { motion: 'orbit', speed: 0.3 },
};
/** Every mode with and without mipmaps, then sharp with mipmaps biased toward the sharper level. */
const VARIANTS = [
  ...[false, true].flatMap((mipmaps) => MODES.map((mode) => ({ mode, mipmaps, mipBias: 0 }))),
  { mode: 'sharp', mipmaps: true, mipBias: -0.5 },
  { mode: 'sharp', mipmaps: true, mipBias: -1 },
] as const;

async function render(
  width: number,
  height: number,
  params: Record<string, unknown>,
  convert: (rgba: Uint8Array) => Float32Array,
): Promise<Float32Array[]> {
  const mounted = await mountHeadless('texel-sampling', { width, height, params });
  const frames: Float32Array[] = [];
  for (let frame = 0; frame < FRAMES; frame++) {
    // Frame 0 every time: the output pass dithers with a pattern that changes per frame, and that
    // one-step noise would otherwise be measured as popping in every variant (and averaged away in
    // the supersampled reference).
    const encoder = mounted.device.createCommandEncoder();
    mounted.instance.frame(
      { time: frame / 60, delta: 1 / 60, frame: 0 },
      encoder,
      mounted.target.createView(),
    );
    mounted.device.queue.submit([encoder.finish()]);
    frames.push(convert(await mounted.read()));
  }
  mounted.destroy();
  return frames;
}

describe.skipIf(process.env.CI)('texel sampling study', () => {
  it('measures error, popping and edge contrast per mode', async () => {
    const results: Record<string, unknown>[] = [];
    for (const [sceneName, sceneParams] of Object.entries(SCENES)) {
      for (const ratio of RATIOS) {
        const width = Math.round(CSS[0] * ratio);
        const height = Math.round(CSS[1] * ratio);
        const reference = await render(
          width * SUPERSAMPLE,
          height * SUPERSAMPLE,
          { ...sceneParams, sampling: 'nearest', mipmaps: false },
          (rgba) => boxDownLuma(rgba, width * SUPERSAMPLE, height * SUPERSAMPLE, SUPERSAMPLE),
        );
        const referencePop = new Means();
        for (let t = 1; t < FRAMES - 1; t++) {
          referencePop.add('all', popping(reference[t - 1]!, reference[t]!, reference[t + 1]!));
        }
        const referenceEdges = new Means();
        for (const frame of reference) {
          referenceEdges.add('far', edgeContrast(rows(frame, width, 0, 0.4), width));
          referenceEdges.add('near', edgeContrast(rows(frame, width, 0.6, 1), width));
        }

        for (const { mode, mipmaps, mipBias } of VARIANTS) {
          {
            const frames = await render(
              width,
              height,
              { ...sceneParams, sampling: mode, mipmaps, mipBias },
              (rgba) => luma(rgba, width, height),
            );
            const m = new Means();
            for (let t = 0; t < FRAMES; t++) {
              const f = frames[t]!;
              const r = reference[t]!;
              m.add('error', meanAbsDiff(f, r));
              m.add('errorFar', meanAbsDiff(rows(f, width, 0, 0.4), rows(r, width, 0, 0.4)));
              m.add('errorNear', meanAbsDiff(rows(f, width, 0.6, 1), rows(r, width, 0.6, 1)));
              m.add('edgesFar', edgeContrast(rows(f, width, 0, 0.4), width));
              m.add('edgesNear', edgeContrast(rows(f, width, 0.6, 1), width));
              if (t > 0 && t < FRAMES - 1) {
                m.add('pop', popping(frames[t - 1]!, f, frames[t + 1]!));
                m.add(
                  'popFar',
                  popping(
                    rows(frames[t - 1]!, width, 0, 0.4),
                    rows(f, width, 0, 0.4),
                    rows(frames[t + 1]!, width, 0, 0.4),
                  ),
                );
                m.add(
                  'popNear',
                  popping(
                    rows(frames[t - 1]!, width, 0.6, 1),
                    rows(f, width, 0.6, 1),
                    rows(frames[t + 1]!, width, 0.6, 1),
                  ),
                );
              }
            }
            const row = {
              scene: sceneName,
              ratio,
              size: `${width}x${height}`,
              mode,
              mipmaps,
              mipBias,
              ...m.toJSON(),
              popReference: Number(referencePop.get('all').toFixed(3)),
              // Edge contrast relative to the reference: under 1 is blurrier, over 1 is harsher.
              sharpFar: Number((m.get('edgesFar') / referenceEdges.get('far')).toFixed(3)),
              sharpNear: Number((m.get('edgesNear') / referenceEdges.get('near')).toFixed(3)),
            };
            results.push(row);
            console.log(
              [
                sceneName.padEnd(10),
                `dpr ${ratio}`.padEnd(8),
                mode.padEnd(8),
                (mipmaps ? `mips${mipBias ? mipBias : ''}` : '').padEnd(8),
                `err ${row.error}`.padEnd(12),
                `far ${row.errorFar}`.padEnd(12),
                `near ${row.errorNear}`.padEnd(12),
                `pop ${row.pop} (ref ${row.popReference})`.padEnd(24),
                `popFar ${row.popFar}`.padEnd(14),
                `sharp far ${row.sharpFar} near ${row.sharpNear}`,
              ].join(' '),
            );
          }
        }
      }
    }
    writeFileSync(
      'experiments/texel-sampling-results.json',
      `${JSON.stringify({ css: CSS, frames: FRAMES, supersample: SUPERSAMPLE, results }, null, 1)}\n`,
    );
  });
});
