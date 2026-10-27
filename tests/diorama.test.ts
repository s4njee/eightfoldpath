import { describe, expect, it } from 'vitest';
import { vec4 } from 'wgpu-matrix';
import type { Pixels } from '../src/gpu/assets.ts';
import { extrude, RIM } from '../src/gpu/diorama/extrude.ts';
import {
  createCameraRig,
  poseCamera,
  poseOnPath,
  scrollProgress,
  type PathKey,
} from '../src/gpu/diorama/rig.ts';
import { parseScene, stairCount, type SceneSource } from '../src/gpu/diorama/scene.ts';
import { createTerrain } from '../src/gpu/diorama/terrain.ts';
import { createSpriteBatch } from '../src/gpu/sprites/batch.ts';
import { orthographicCamera } from '../src/gpu/sprites/camera.ts';
import village from '../assets/scenes/village.json';
import { expectValid, getTestDevice, readTexture } from './gpu.ts';

const LEGEND: SceneSource['legend'] = {
  g: { top: 'grass', side: 'cliff' },
  c: { top: 'cobblestone', side: 'stone-wall' },
  s: { top: 'cobblestone', side: 'stone-wall', shape: 'stairs' },
  r: { top: 'dirt', shape: 'slope' },
  '.': null,
};

function image(width: number, height: number, rgba: (x: number, y: number) => number[]): Pixels {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(rgba(x, y), (y * width + x) * 4);
  }
  return { width, height, data };
}

describe('parseScene (4.1)', () => {
  it('lays out a hand-written scene', () => {
    const scene = parseScene({
      legend: LEGEND,
      map: ['gcc', 'g.c'],
      heights: ['012', '000'],
      sprites: [{ art: 'mage', at: [2.5, 0.5] }],
    });
    expect([scene.width, scene.depth]).toEqual([3, 2]);
    expect(scene.cells.map((cell) => cell.kind)).toEqual([0, 1, 1, 0, -1, 1]);
    expect(scene.cells.map((cell) => cell.steps)).toEqual([0, 1, 2, 0, 0, 0]);
    expect(scene.art).toEqual(['cliff', 'cobblestone', 'grass', 'mage', 'stone-wall']);
    // Feet on the ground: column (2, 0) is two steps of half a unit.
    expect(scene.sprites[0]!.position).toEqual([2.5, 1, 0.5]);
    expect(scene.heightAt(1.5, 1.5)).toBe(scene.base);
    expect(scene.heightAt(-3, 0)).toBe(scene.base);
  });

  it('is deterministic', () => {
    const source = village as unknown as SceneSource;
    const a = parseScene(source);
    const b = parseScene(source);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.sprites.map((sprite) => sprite.position)).toEqual(
      b.sprites.map((sprite) => sprite.position),
    );
  });

  it('reads the same scene from images', () => {
    const colours: Record<string, number[]> = { g: [74, 140, 58], c: [128, 128, 128] };
    const rows = ['gcc', 'ggc'];
    const steps = ['012', '003'];
    const map = image(3, 2, (x, y) => [...colours[rows[y]![x]!]!, 255]);
    const heights = image(3, 2, (x, y) => [Number(steps[y]![x]), 0, 0, 255]);
    const fromImages = parseScene(
      { legend: { '#4a8c3a': LEGEND.g!, '#808080': LEGEND.c! } },
      { map, heights },
    );
    const fromRows = parseScene({ legend: LEGEND, map: rows, heights: steps });
    expect(fromImages.cells).toEqual(fromRows.cells);
    expect(fromImages.kinds).toEqual(fromRows.kinds);
  });

  it('says where a problem is', () => {
    expect(() => parseScene({ legend: LEGEND, map: ['gx'] })).toThrow(/"x" at row 1, column 2/);
    expect(() => parseScene({ legend: LEGEND, map: ['gg'], heights: ['0'] })).toThrow(/heights/);
    expect(() => parseScene({ legend: LEGEND, map: ['gg'], heights: ['0?'] })).toThrow(
      /row 1, column 2/,
    );
    // Stairs need somewhere higher to climb to.
    expect(() => parseScene({ legend: LEGEND, map: ['gs'] })).toThrow(/no higher neighbour/);
  });

  it('climbs stairs and slopes toward the higher neighbour', () => {
    const scene = parseScene({
      legend: LEGEND,
      heightStep: 0.5,
      map: ['g', 's', 'g', 'r', 'g'],
      heights: ['4', '2', '1', '0', '0'],
    });
    // The stairs climb north from one unit to two, in four treads of a quarter unit.
    expect(scene.cell(0, 1)!.rises).toBe('n');
    expect(stairCount(1)).toBe(4);
    expect(scene.heightAt(0.5, 1.99)).toBe(1);
    expect(scene.heightAt(0.5, 1.6)).toBe(1.25);
    expect(scene.heightAt(0.5, 1.01)).toBe(1.75);
    // The slope climbs north from 0 to half a unit, evenly.
    expect(scene.cell(0, 3)!.rises).toBe('n');
    expect(scene.heightAt(0.5, 3.75)).toBeCloseTo(0.125);
    expect(scene.heightAt(0.5, 3.25)).toBeCloseTo(0.375);
  });
});

describe('extrude (4.2)', () => {
  const sides = (box: { bottom: readonly number[] }) => box.bottom;

  it('runs walls down only as far as the ground beside them', () => {
    const scene = parseScene({ legend: LEGEND, heightStep: 1, map: ['gg'], heights: ['01'] });
    const [low, high] = extrude(scene);
    // n, e, s, w. The low column's east face meets a higher neighbour: nothing to draw (its
    // bottom is above its top, so it collapses). Off the map, walls run to the base.
    expect(sides(low!)).toEqual([-1, 1, -1, -1]);
    expect(sides(high!)).toEqual([-1, -1, -1, 0]);
    expect(high!.flags & RIM.w).toBe(RIM.w);
    expect(low!.flags & RIM.e).toBe(0);
  });

  it('collapses the faces between equal neighbours', () => {
    const scene = parseScene({ legend: LEGEND, map: ['gg', 'gg'], heights: ['11', '11'] });
    for (const box of extrude(scene)) {
      const inner = box.bottom.filter((bottom) => bottom === 0.5);
      expect(inner).toHaveLength(2);
    }
  });

  it('dithers tops of different art together only at the same height', () => {
    const scene = parseScene({ legend: LEGEND, map: ['gcg'], heights: ['001'] });
    const [grass, stone] = extrude(scene);
    expect(grass!.blend).toEqual([undefined, 'cobblestone', undefined, undefined]);
    // Its east neighbour is higher, so there is a wall between them, not a seam.
    expect(stone!.blend).toEqual([undefined, undefined, undefined, 'grass']);
  });

  it('builds stairs as treads that meet the ground at both ends', () => {
    const scene = parseScene({
      legend: LEGEND,
      heightStep: 0.5,
      map: ['g', 's', 'g'],
      heights: ['4', '2', '2'],
    });
    const treads = extrude(scene).filter((box) => box.topArt === 'cobblestone');
    expect(treads.map((box) => box.top[0])).toEqual([1, 1.25, 1.5, 1.75]);
    // From the south, the first tread is flush with the ground; each riser rises to the next.
    expect(treads.map((box) => box.bottom[2])).toEqual([1, 1, 1.25, 1.5]);
    // Together the treads cover the cell exactly.
    expect(treads.reduce((sum, box) => sum + box.sz, 0)).toBeCloseTo(1);
  });

  it('leaves no gaps in the village', () => {
    const scene = parseScene(village as unknown as SceneSource);
    const boxes = extrude(scene);
    // Each side reaches down at least to the ground just beside its middle.
    for (const box of boxes) {
      const probes: readonly [number, number][] = [
        [box.x + box.sx / 2, box.z - 1e-3],
        [box.x + box.sx + 1e-3, box.z + box.sz / 2],
        [box.x + box.sx / 2, box.z + box.sz + 1e-3],
        [box.x - 1e-3, box.z + box.sz / 2],
      ];
      probes.forEach(([x, z], side) => {
        expect(box.bottom[side]).toBeLessThanOrEqual(scene.heightAt(x, z) + 1e-6);
      });
    }
  });
});

describe('camera rig (4.3)', () => {
  const pose = { focus: [0, 0, 0] as const, yaw: 0, pitch: 35, fov: 25, distance: 20 };
  const path: PathKey[] = [
    { ...pose, at: 0 },
    { ...pose, at: 0.5, focus: [10, 0, 0], yaw: 1 },
    { ...pose, at: 1, focus: [10, 0, 10], distance: 10 },
  ];

  it('passes through every key and stays on the path between them', () => {
    for (const key of path) {
      const at = poseOnPath(path, key.at);
      expect(at.focus.map((v) => +v.toFixed(6))).toEqual([...key.focus]);
      expect(at.yaw).toBeCloseTo(key.yaw);
      expect(at.distance).toBeCloseTo(key.distance);
    }
    // Clamped at the ends.
    expect(poseOnPath(path, 2).distance).toBeCloseTo(10);
    // Continuous: small steps make small moves.
    let previous = poseOnPath(path, 0);
    for (let p = 0.01; p <= 1; p += 0.01) {
      const next = poseOnPath(path, p);
      expect(
        Math.hypot(next.focus[0] - previous.focus[0], next.focus[2] - previous.focus[2]),
      ).toBeLessThan(0.5);
      previous = next;
    }
  });

  it('measures scrolling through the viewport', () => {
    expect(scrollProgress({ top: 800, height: 400 }, 800)).toBe(0);
    expect(scrollProgress({ top: 200, height: 400 }, 800)).toBe(0.5);
    expect(scrollProgress({ top: -400, height: 400 }, 800)).toBe(1);
  });

  it('frames the same height at the focus in orthographic as in perspective', () => {
    const half = pose.distance * Math.tan((pose.fov * Math.PI) / 360);
    // A point straight up the screen from the focus, at the top of the frame.
    const perspective = poseCamera(pose, 1.5, 'perspective');
    const ortho = poseCamera(pose, 1.5, 'orthographic');
    const up = perspective.up;
    const top = [up[0] * half, up[1] * half, up[2] * half, 1];
    for (const camera of [perspective, ortho]) {
      const clip = vec4.transformMat4(top, camera.viewProj);
      expect(clip[1]! / clip[3]!).toBeCloseTo(1, 4);
    }
  });

  it('eases toward input, keeps in bounds and springs back from parallax', () => {
    const rig = createCameraRig(pose, { bounds: [-5, -5, 5, 5], dollyRange: [0.5, 2] });
    rig.pan(100, 0);
    expect(rig.target.focus[0]).toBe(5);
    rig.dolly(0.01);
    expect(rig.target.distance).toBe(10);
    rig.update(0.25, 1);
    // One easing time covers about 63% of the way.
    expect(rig.pose.focus[0]).toBeCloseTo(5 * (1 - Math.exp(-1)), 4);
    rig.parallax(1, 0);
    for (let i = 0; i < 60; i++) rig.update(0.05, 1);
    const leaning = rig.update(0, 1).eye;
    rig.parallax(0, 0);
    for (let i = 0; i < 60; i++) rig.update(0.05, 1);
    const back = rig.update(0, 1).eye;
    expect(Math.abs(leaning[0] - back[0])).toBeGreaterThan(0.1);
    // The target never moved for parallax.
    expect(rig.target.yaw).toBe(0);
  });
});

describe('createTerrain (4.2)', () => {
  it('draws tops and walls with their own art', async () => {
    const device = await getTestDevice();
    const solid = (rgb: number[]) => image(4, 4, () => [...rgb, 255]);
    const art = {
      red: solid([255, 0, 0]),
      green: solid([0, 255, 0]),
      blue: solid([0, 0, 255]),
      white: solid([255, 255, 255]),
    };
    const scene = parseScene({
      legend: { a: { top: 'red', side: 'blue' }, b: { top: 'green', side: 'white' } },
      heightStep: 1,
      map: ['ab'],
      heights: ['01'],
    });
    const size = 16;
    const target = device.createTexture({
      size: [size, size],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const depth = device.createTexture({
      size: [size, size],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    async function render(camera: ReturnType<typeof orthographicCamera>) {
      return expectValid(device, async () => {
        const terrain = createTerrain(device, { scene, art, colorFormat: 'rgba8unorm' });
        terrain.update({ dither: 0, rim: 0 });
        const batch = createSpriteBatch(device, { sheets: [art.red], colorFormat: 'rgba8unorm' });
        const view = batch.createView();
        view.update(camera, { time: 0 });
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: target.createView(),
              loadOp: 'clear',
              storeOp: 'store',
              clearValue: [0, 0, 0, 1],
            },
          ],
          depthStencilAttachment: {
            view: depth.createView(),
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
            depthClearValue: 1,
          },
        });
        terrain.draw(pass, view);
        pass.end();
        device.queue.submit([encoder.finish()]);
        const pixels = await readTexture(device, target);
        terrain.destroy();
        batch.destroy();
        view.destroy();
        return pixels;
      });
    }
    const at = (pixels: Uint8Array, x: number, y: number) => [
      ...pixels.subarray((y * size + x) * 4, (y * size + x) * 4 + 3),
    ];

    // From above: the low red top on the left, the high green top on the right.
    const top = orthographicCamera([0, -1, 0.0001], [1, 0, 0.5], 2, 8);
    const above = await render(top);
    const [left, right] =
      top.right[0] > 0
        ? [
            [255, 0, 0],
            [0, 255, 0],
          ]
        : [
            [0, 255, 0],
            [255, 0, 0],
          ];
    expect(at(above, 4, 8)).toEqual(left);
    expect(at(above, 12, 8)).toEqual(right);
    // From the west, level with the step: the high column's white wall above the low one.
    const west = await render(orthographicCamera([1, 0, 0], [1, 0.5, 0.5], 2, 8));
    expect(at(west, 8, 4)).toEqual([255, 255, 255]);
  });
});
