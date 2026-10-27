import { describe, it, vi } from 'vitest';
import { loadEffect } from '../src/effects/registry.ts';
import { defaultParams, type InspectState } from '../src/effects/types.ts';
import { noProfiler } from '../src/gpu/profiler.ts';
import { getTestDevice, readTexture } from '../tests/gpu.ts';
import { BACKDROPS, compositeOver, fakeCanvas, writePng } from '../tests/headless.ts';

// Renders every inspector view and stage of the parallax header to PNGs, so the layers, the
// circle of confusion, the occlusion mask and the shafts can be looked at one by one.
//
//   npx vitest run --silent=false --config experiments/vite.config.ts experiments/parallax-header-views.test.ts
//
// PARALLAX_SIZE (default 1280x400), PARALLAX_TIME (default 2) and PARALLAX_PARAMS (JSON over the
// defaults) change the frame; PARALLAX_OUT (default output/shots) where it goes.

vi.setConfig({ testTimeout: 600_000 });

describe('parallax header views', () => {
  it('renders', async () => {
    const [width, height] = (process.env.PARALLAX_SIZE ?? '1280x400').split('x').map(Number) as [
      number,
      number,
    ];
    const seconds = Number(process.env.PARALLAX_TIME ?? 2);
    const out = process.env.PARALLAX_OUT ?? 'output/shots';
    const device = await getTestDevice();
    const effect = await loadEffect('parallax-header');
    const target = device.createTexture({
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const inspect: InspectState = { view: 'final', off: new Set() };
    const params = {
      ...defaultParams(effect.params),
      ...(JSON.parse(process.env.PARALLAX_PARAMS ?? '{}') as object),
    };
    const instance = await effect.create({
      device,
      format: 'rgba8unorm',
      canvas: fakeCanvas(width, height),
      params,
      profiler: noProfiler,
      inspect,
    });
    instance.resize(width, height, 1);
    const spec = effect.inspect ?? {};
    const choices: [string, InspectState][] = [
      ['final', { view: 'final', off: new Set() }],
      ...(spec.views ?? []).map((view): [string, InspectState] => [view, { view, off: new Set() }]),
      ...(spec.stages ?? []).map((stage): [string, InspectState] => [
        `no-${stage}`,
        { view: 'final', off: new Set([stage]) },
      ]),
    ];
    for (const [name, state] of choices) {
      inspect.view = state.view;
      inspect.off = state.off;
      const encoder = device.createCommandEncoder();
      instance.frame({ time: seconds, delta: 1 / 60, frame: 1 }, encoder, target.createView());
      device.queue.submit([encoder.finish()]);
      const path = `${out}/parallax-header-${name.replace(/ /g, '-')}.png`;
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
