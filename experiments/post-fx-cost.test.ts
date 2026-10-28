import { describe, it, vi } from 'vitest';
import { createBenchDevice } from '../tests/bench.ts';
import { mountHeadless } from '../tests/headless.ts';

// Stories 5.4, 5.7 and 5.8: what pixel bloom, the grade and finishing add to a village frame at
// 1920 x 1080, as the slope of repeated frames (tests/bench.ts). Not `npm run study`: a quick read
// for the notes, labelled as taken on a shared GPU.
//
//   npx vitest run --silent=false --config experiments/vite.config.ts experiments/post-fx-cost.test.ts

vi.setConfig({ testTimeout: 3_600_000 });

const CASES: [string, string | undefined, Record<string, unknown>][] = [
  ['pixel-bloom', 'no bloom', {}],
  ['pixel-bloom', 'tail defaults', {}],
  ['pixel-bloom', undefined, {}],
  ['pixel-bloom', 'high threshold, averaged', {}],
  ['pixel-bloom', undefined, {}],
  ['pixel-bloom', 'tail defaults', {}],
  ['colour-grading', undefined, { area: 'the square', strength: 0 }],
  ['colour-grading', undefined, { area: 'the square' }],
  ['finishing', 'none', { grade: false }],
  ['finishing', undefined, { grade: false }],
  ['finishing', undefined, {}],
];

describe('post-fx cost', () => {
  it('times each configuration', async () => {
    const bench = await createBenchDevice();
    for (const [id, preset, params] of CASES) {
      const mounted = await mountHeadless(id, {
        width: 1920,
        height: 1080,
        preset,
        params: { sway: 0, ...params },
        device: bench.device,
        profiler: bench.profiler,
      });
      mounted.step(12);
      const m = await bench.measure((encoder) => mounted.encode(encoder));
      console.log(
        `${id} ${preset ?? 'default'} ${JSON.stringify(params)}: slope ${m.slopeMs.toFixed(3)} ms (${m.slopeMinMs.toFixed(3)}..${m.slopeMaxMs.toFixed(3)}), span ${m.spanMs.toFixed(3)} ms, ${m.passes} passes`,
      );
      mounted.destroy();
    }
    bench.destroy();
  });
});
