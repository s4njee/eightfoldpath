import { describe, expect, it } from 'vitest';
import slime from '../assets/sprites/slime-bounce.png?url';
import traveller from '../assets/sprites/traveller.png?url';
import cobblestone from '../assets/tiles/cobblestone.png?url';
import { loadPixels } from '../src/gpu/assets.ts';
import { createSpriteBatch, TEXEL, type Sprite } from '../src/gpu/sprites/batch.ts';
import { dioramaCamera, framingDistance, orthographicCamera } from '../src/gpu/sprites/camera.ts';
import { createSceneTargets } from '../src/gpu/sprites/targets.ts';
import { expectValid, getTestDevice, readTexture } from './gpu.ts';

const SIZE = 64;

async function render(sprites: Sprite[], time: number, sampleCount: 1 | 4 = 1) {
  const device = await getTestDevice();
  const sheets = await Promise.all([cobblestone, traveller, slime].map((url) => loadPixels(url)));
  const output = device.createTexture({
    size: [SIZE, SIZE],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  return expectValid(device, async () => {
    const batch = createSpriteBatch(device, { sheets, colorFormat: 'rgba8unorm' });
    const view = batch.createView();
    const targets = createSceneTargets(device, { colorFormat: 'rgba8unorm' });
    targets.setSampleCount(sampleCount);
    targets.resize(SIZE, SIZE);
    batch.setSprites(sprites);
    view.update(
      dioramaCamera({
        pitch: 35,
        yaw: 0,
        fov: 25,
        focus: [0, 1, 0],
        distance: framingDistance(25, 6),
        aspect: 1,
      }),
      { time, sampling: 'sharp', alphaCut: sampleCount > 1 ? 0.02 : 0.5 },
    );
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass(targets.pass(output.createView(), [0, 0, 0, 1]));
    batch.draw(pass, view, { sampleCount, coverage: sampleCount > 1 });
    pass.end();
    device.queue.submit([encoder.finish()]);
    const pixels = await readTexture(device, output);
    view.destroy();
    batch.destroy();
    targets.destroy();
    output.destroy();
    return pixels;
  });
}

describe('sprite batcher', () => {
  it('sizes a sprite from its art at the shared texel density', () => {
    expect(TEXEL * 16).toBe(1);
  });

  it('draws ground and standing sprites, with and without MSAA', async () => {
    const sprites: Sprite[] = [
      { sheet: 0, position: [0, 0, 0], facing: 'ground', region: [0, 0, 64, 64] },
      { sheet: 1, position: [0, 0, 0] },
    ];
    for (const samples of [1, 4] as const) {
      const pixels = await render(sprites, 0, samples);
      expect(new Set(pixels).size).toBeGreaterThan(16);
    }
  });

  it('advances a flipbook with the clock, not the frame count', async () => {
    const slimeAt = (time: number) =>
      render([{ sheet: 2, position: [0, 0, 0], region: [0, 0, 30, 66], frames: 4, fps: 4 }], time);
    const first = Buffer.from(await slimeAt(0)).toString('base64');
    expect(Buffer.from(await slimeAt(0.1)).toString('base64')).toBe(first);
    expect(Buffer.from(await slimeAt(0.3)).toString('base64')).not.toBe(first);
  });

  it('refuses a sprite whose sheet was not loaded', async () => {
    const device = await getTestDevice();
    const batch = createSpriteBatch(device, {
      sheets: [await loadPixels(traveller)],
      colorFormat: 'rgba8unorm',
    });
    expect(() => batch.setSprites([{ sheet: 3, position: [0, 0, 0] }])).toThrowError(/sheet 3/);
    batch.destroy();
  });
});

describe('diorama cameras', () => {
  it('pitches down at the focus and frames the requested height', () => {
    const camera = dioramaCamera({
      pitch: 35,
      yaw: 0,
      fov: 25,
      focus: [0, 0, 0],
      distance: 10,
      aspect: 1,
    });
    expect(camera.eye[1]).toBeCloseTo(10 * Math.sin((35 * Math.PI) / 180));
    expect(camera.forward[1]).toBeLessThan(0);
    expect(camera.right[1]).toBeCloseTo(0);
    expect(framingDistance(90, 2)).toBeCloseTo(1);
  });

  it('looks along a light direction for a shadow map', () => {
    const light = orthographicCamera([0, -1, -1], [0, 0, 0], 8);
    const length = Math.hypot(...light.forward);
    expect(light.forward[1] / length).toBeCloseTo(-Math.SQRT1_2);
    expect(light.forward[2] / length).toBeCloseTo(-Math.SQRT1_2);
  });
});
