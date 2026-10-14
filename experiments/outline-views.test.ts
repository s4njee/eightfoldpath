import { describe, it, vi } from 'vitest';
import { loadEffect } from '../src/effects/registry.ts';
import { defaultParams, type InspectState } from '../src/effects/types.ts';
import { noProfiler } from '../src/gpu/profiler.ts';
import { getTestDevice, readTexture } from '../tests/gpu.ts';
import { BACKDROPS, compositeOver, fakeCanvas, writePng } from '../tests/headless.ts';

// Renders every inspector view and stage of the outlines effect to PNGs, at the size the
// inspector test uses and at a readable one, so the edge sources can be looked at one by one.
//
//   npx vitest run --silent=false --config experiments/vite.config.ts experiments/outline-views.test.ts
//
// OUTLINE_SIZE (default 960x540) and OUTLINE_TIME (default 1) change the frame.

vi.setConfig({ testTimeout: 600_000 });

describe('outline views', () => {
  it('renders', async () => {
    const [width, height] = (process.env.OUTLINE_SIZE ?? '960x540').split('x').map(Number) as [
      number,
      number,
    ];
    const seconds = Number(process.env.OUTLINE_TIME ?? 1);
    const device = await getTestDevice();
    const effect = await loadEffect('outlines');
    const target = device.createTexture({
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const inspect: InspectState = { view: 'final', off: new Set() };
    const instance = await effect.create({
      device,
      format: 'rgba8unorm',
      canvas: fakeCanvas(width, height),
      params: defaultParams(effect.params),
      profiler: noProfiler,
      inspect,
    });
    instance.resize(width, height, 1);
    const spec = effect.inspect ?? {};
    const choices: [string, InspectState][] = [
      ['final', { view: 'final', off: new Set() }],
      ...(spec.views ?? []).map((view): [string, InspectState] => [view, { view, off: new Set() }]),
      ...(spec.stages ?? []).map((stage): [string, InspectState] => [
        `no-${stage.replace(/ /g, '-')}`,
        { view: 'final', off: new Set([stage]) },
      ]),
    ];
    for (const [name, state] of choices) {
      inspect.view = state.view;
      inspect.off = state.off;
      const encoder = device.createCommandEncoder();
      instance.frame({ time: seconds, delta: 1 / 60, frame: 1 }, encoder, target.createView());
      device.queue.submit([encoder.finish()]);
      const path = `output/shots/outline-views-${width}x${height}-${name}.png`;
      writePng(
        path,
        width,
        height,
        compositeOver(await readTexture(device, target), BACKDROPS.dark!),
      );
      console.log(`shot: ${path}`);
    }
    instance.destroy();
    target.destroy();
  });
});
