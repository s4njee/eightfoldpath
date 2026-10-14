import { describe, expect, it } from 'vitest';
import { listEffects, loadEffect } from '../src/effects/registry.ts';
import { defaultParams, type InspectState } from '../src/effects/types.ts';
import { noProfiler } from '../src/gpu/profiler.ts';
import { expectValid, getTestDevice, readTexture } from './gpu.ts';

const WIDTH = 48;
const HEIGHT = 32;

function fakeCanvas(): HTMLCanvasElement {
  return Object.assign(new EventTarget(), {
    width: WIDTH,
    height: HEIGHT,
    style: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: WIDTH, height: HEIGHT }),
    setPointerCapture() {},
    releasePointerCapture() {},
  }) as unknown as HTMLCanvasElement;
}

/** Every inspector choice an effect declares: each view alone, and each stage switched off. */
async function choices(id: string): Promise<{ name: string; state: InspectState }[]> {
  const spec = (await loadEffect(id)).inspect ?? {};
  return [
    ...(spec.views ?? []).map((view) => ({
      name: `view ${view}`,
      state: { view, off: new Set<string>() },
    })),
    ...(spec.stages ?? []).map((stage) => ({
      name: `without ${stage}`,
      state: { view: 'final', off: new Set([stage]) },
    })),
    {
      name: 'every stage off',
      state: { view: 'final', off: new Set(spec.stages ?? []) },
    },
  ];
}

describe('layer inspector', () => {
  const inspectable = listEffects().map((meta) => meta.id);

  it.each(inspectable)('%s draws every view and every stage switched off', async (id) => {
    const device = await getTestDevice();
    const effect = await loadEffect(id);
    const target = device.createTexture({
      size: [WIDTH, HEIGHT],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const inspect: InspectState = { view: 'final', off: new Set() };
    const instance = await effect.create({
      device,
      format: 'rgba8unorm',
      canvas: fakeCanvas(),
      params: defaultParams(effect.params),
      profiler: noProfiler,
      inspect,
    });
    instance.resize(WIDTH, HEIGHT, 1);

    const pictures = new Map<string, string>();
    for (const { name, state } of await choices(id)) {
      // The host mutates the same object between frames; so does this test.
      inspect.view = state.view;
      inspect.off = state.off;
      await expectValid(device, () => {
        const encoder = device.createCommandEncoder();
        instance.frame({ time: 1, delta: 1 / 60, frame: 1 }, encoder, target.createView());
        device.queue.submit([encoder.finish()]);
      });
      const pixels = await readTexture(device, target);
      pictures.set(name, Buffer.from(pixels).toString('base64'));
    }
    instance.destroy();
    target.destroy();

    // A view or stage that changes nothing is either broken or not worth listing.
    const distinct = new Set(pictures.values());
    expect(distinct.size, [...pictures.keys()].join(', ')).toBe(pictures.size);
  });
});
