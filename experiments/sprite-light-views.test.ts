import { describe, it, vi } from 'vitest';
import { loadEffect } from '../src/effects/registry.ts';
import { defaultParams, type InspectState } from '../src/effects/types.ts';
import { noProfiler } from '../src/gpu/profiler.ts';
import { getTestDevice, readTexture } from '../tests/gpu.ts';
import { BACKDROPS, compositeOver, fakeCanvas, writePng } from '../tests/headless.ts';

// Inspector shots for stories 3.3, 3.4 and 3.7: renders an effect with each layer-inspector choice
// and writes PNGs, which scripts/shot.mjs cannot do.
//
//   VIEWS_EFFECT=sprite-lighting VIEWS='final,normals,-rim' VIEWS_TIME=2 \
//     npx vitest run --config experiments/vite.config.ts experiments/sprite-light-views.test.ts
//
// Each entry in VIEWS is a view name, or `-stage` to switch that stage off (`-a-b` is not
// supported; use `-a+b`). VIEWS_PARAMS is JSON applied over the defaults (and VIEWS_PRESET).

vi.setConfig({ testTimeout: 600_000 });
const env = process.env;

describe.skipIf(!env.VIEWS_EFFECT)('inspector views', () => {
  it('renders', async () => {
    const id = env.VIEWS_EFFECT!;
    const [width, height] = (env.VIEWS_SIZE ?? '960x540').split('x').map(Number) as [
      number,
      number,
    ];
    const seconds = Number(env.VIEWS_TIME ?? '2');
    const effect = await loadEffect(id);
    const preset = env.VIEWS_PRESET ? effect.presets?.[env.VIEWS_PRESET] : undefined;
    const params = {
      ...defaultParams(effect.params),
      ...preset,
      ...(JSON.parse(env.VIEWS_PARAMS ?? '{}') as object),
    };
    const device = await getTestDevice();
    const target = device.createTexture({
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    for (const choice of (env.VIEWS ?? 'final').split(',')) {
      const inspect: InspectState = {
        view: choice.startsWith('-') ? 'final' : choice,
        off: new Set(choice.startsWith('-') ? choice.slice(1).split('+') : []),
      };
      // A fresh instance per choice, so every picture shows the same moment.
      const instance = await effect.create({
        device,
        format: 'rgba8unorm',
        canvas: fakeCanvas(width, height),
        params: { ...params } as never,
        profiler: noProfiler,
        inspect,
      });
      instance.resize(width, height, 1);
      const fps = 30;
      for (let frame = 0; frame <= seconds * fps; frame++) {
        const encoder = device.createCommandEncoder();
        instance.frame(
          { time: frame / fps, delta: frame ? 1 / fps : 0, frame },
          encoder,
          target.createView(),
        );
        device.queue.submit([encoder.finish()]);
      }
      const rgba = await readTexture(device, target);
      instance.destroy();
      const tag = env.VIEWS_TAG ? `-${env.VIEWS_TAG}` : '';
      const path = `output/shots/${id}${tag}-view-${choice.replace(/[^\w+-]/g, '_')}.png`;
      writePng(path, width, height, compositeOver(rgba, BACKDROPS.dark!));
      console.log(`view: ${path}`);
    }
  });
});
