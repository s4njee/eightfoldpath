import barrel from '../../../assets/sprites/barrel.png?url';
import chest from '../../../assets/sprites/chest.png?url';
import knight from '../../../assets/sprites/knight.png?url';
import lantern from '../../../assets/sprites/lantern.png?url';
import mage from '../../../assets/sprites/mage.png?url';
import traveller from '../../../assets/sprites/traveller.png?url';
import tree from '../../../assets/sprites/tree.png?url';
import cobblestone from '../../../assets/tiles/cobblestone.png?url';
import grass from '../../../assets/tiles/grass.png?url';
import { loadPixels } from '../../gpu/assets.ts';
import {
  createLowResPath,
  pixelCamera,
  snapToPixels,
  UPSCALE_FILTERS,
  virtualSize,
  type PixelCamera,
  type UpscaleFilter,
  type VirtualSize,
} from '../../gpu/pixel/lowres.ts';
import { createHdrTail } from '../../gpu/post/index.ts';
import { createSpriteBatch, TEXEL, type Sprite } from '../../gpu/sprites/batch.ts';
import { createSceneTargets } from '../../gpu/sprites/targets.ts';
import { defaultInspect, defineEffect } from '../types.ts';
import { meta } from './meta.ts';

const SHEETS = [cobblestone, grass, traveller, mage, knight, lantern, barrel, chest, tree];
const [COBBLES, GRASS, TRAVELLER, MAGE, KNIGHT, LANTERN, BARREL, CHEST, TREE] = SHEETS.map(
  (_, index) => index,
) as number[] as [number, number, number, number, number, number, number, number, number];

/** Each ground tile shows 96 texels: six world units. */
const TILE = 96;
const TILE_SIZE = TILE * TEXEL;
const CLEAR = [0.02, 0.022, 0.04, 1] as const;

/**
 * A square of cobbles in a field of grass, a few standing sprites and a traveller walking a circle
 * round them. Sprites face the camera fully, so with one texel per virtual pixel each texel is
 * exactly one virtual pixel; an upright sprite would be squashed by the camera's pitch and lose
 * rows (notes.md). `walker` is the traveller's feet, already snapped if snapping is on.
 */
function scene(walker: readonly [number, number, number], facingLeft: boolean): Sprite[] {
  const sprites: Sprite[] = [];
  for (let row = -1; row <= 1; row++) {
    for (let column = -1; column <= 1; column++) {
      sprites.push({
        sheet: row === 0 && column === 0 ? COBBLES : GRASS,
        position: [column * TILE_SIZE, 0, row * TILE_SIZE],
        facing: 'ground',
        region: [0, 0, TILE, TILE],
      });
    }
  }
  const stand = (sheet: number, x: number, z: number, flipX = false): Sprite => ({
    sheet,
    position: [x, 0, z],
    facing: 'camera',
    flipX,
  });
  sprites.push(
    stand(TREE, -4.5, -3.5),
    stand(LANTERN, 2.5, -2.5),
    stand(BARREL, -1.75, -1.5),
    stand(CHEST, 0.5, -1.25),
    stand(MAGE, -2.5, 0.5),
    stand(KNIGHT, 1.75, 0.25, true),
    { sheet: TRAVELLER, position: walker, facing: 'camera', flipX: facingLeft },
  );
  return sprites;
}

export const effect = defineEffect({
  meta,
  params: {
    virtualHeight: {
      type: 'number',
      default: 180,
      min: 90,
      max: 540,
      step: 1,
      label: 'virtual height (pixels)',
    },
    integerScale: { type: 'boolean', default: false, label: 'whole-number scale' },
    upscale: { type: 'select', default: 'sharp', options: UPSCALE_FILTERS },
    pixelsPerTexel: {
      type: 'number',
      default: 1,
      min: 1,
      max: 3,
      step: 1,
      label: 'virtual pixels per texel',
    },
    // Orthographic by default: only then does snapping hold the whole scene still (notes.md).
    projection: {
      type: 'select',
      default: 'orthographic',
      options: ['orthographic', 'perspective'],
    },
    motion: { type: 'select', default: 'pan', options: ['pan', 'orbit', 'still'] },
    speed: { type: 'number', default: 0.4, min: 0, max: 3, step: 0.01, label: 'camera speed' },
    walk: { type: 'number', default: 0.6, min: 0, max: 3, step: 0.01, label: 'walk speed' },
    pitch: { type: 'number', default: 35, min: 5, max: 85, step: 0.5, label: 'camera pitch' },
    fov: { type: 'number', default: 25, min: 10, max: 60, step: 0.5, label: 'field of view' },
  },
  presets: {
    'whole-number scale': { integerScale: true, upscale: 'nearest' },
    'two pixels per texel': { pixelsPerTexel: 2, virtualHeight: 360 },
    perspective: { projection: 'perspective' },
    orbit: { motion: 'orbit', speed: 0.5 },
  },
  inspect: {
    views: ['virtual'],
    stages: ['low-res', 'snapping', 'sub-pixel offset'],
  },

  async create({ device, format, hdr, params, profiler, inspect = defaultInspect() }) {
    const tail = createHdrTail(device, { format, hdr, label: 'low-res-path' });
    const sheets = await Promise.all(SHEETS.map((url) => loadPixels(url)));
    const batch = createSpriteBatch(device, {
      sheets,
      colorFormat: tail.scene.format,
      label: 'low-res-path',
    });
    const view = batch.createView();
    const lowres = createLowResPath(device, {
      colorFormat: tail.scene.format,
      label: 'low-res-path',
    });
    // The full-resolution path it is compared with: MSAA, alpha-to-coverage and sharp sampling,
    // what sprite-batch does.
    const full = createSceneTargets(device, { colorFormat: tail.scene.format, label: 'full-res' });
    full.setSampleCount(4);
    let width = 1;
    let height = 1;
    let size: VirtualSize = virtualSize(1, 1, 1);
    let pan = 0;
    let yaw = 0.35;
    let stride = 0;

    function fitVirtual() {
      size = virtualSize(width, height, params.virtualHeight, {
        integerScale: params.integerScale,
      });
      lowres.resize(size, width, height);
    }

    return {
      resize(nextWidth, nextHeight) {
        width = nextWidth;
        height = nextHeight;
        tail.resize(width, height);
        full.resize(width, height);
        fitVirtual();
      },
      frame(time, encoder, target) {
        // The virtual size follows its parameters live; this is cheap when nothing changed.
        fitVirtual();
        if (params.motion === 'pan') pan += time.delta * params.speed * 0.35;
        if (params.motion === 'orbit') yaw += time.delta * params.speed * 0.25;
        stride += time.delta * params.walk * 0.5;

        const lowResOn = !inspect.off.has('low-res');
        const snap = lowResOn && !inspect.off.has('snapping');
        const unit = TEXEL / params.pixelsPerTexel;
        const projection = params.projection as 'perspective' | 'orthographic';
        // A slow figure of eight over the square, so the camera moves both across and up the image.
        const focus = [Math.sin(pan) * 2.2, 1.2, Math.sin(pan * 2) * 1.2] as const;
        const diorama = { pitch: params.pitch, yaw, fov: params.fov, focus, projection };

        let shot: PixelCamera;
        if (lowResOn) {
          shot = pixelCamera({ ...diorama, size, worldPerPixel: unit, snap });
        } else {
          // The same framing at the canvas's own resolution: a virtual pixel is `scale` pixels.
          const canvas = virtualSize(width, height, height, { margin: 0 });
          shot = pixelCamera({
            ...diorama,
            size: canvas,
            worldPerPixel: unit / size.scale,
            snap: false,
          });
        }
        const walker = [Math.cos(stride) * 2.4, 0, Math.sin(stride) * 2.4 + 0.4] as const;
        batch.setSprites(
          scene(
            snap ? snapToPixels(walker, shot, unit) : walker,
            // Turned the way it walks across the screen.
            Math.cos(stride) * shot.right[2] - Math.sin(stride) * shot.right[0] < 0,
          ),
        );

        if (lowResOn) {
          view.update(shot.camera, { time: 0, sampling: 'nearest', alphaCut: 0.5 });
          const pass = encoder.beginRenderPass(lowres.pass(CLEAR, profiler.pass('virtual')));
          batch.draw(pass, view);
          pass.end();
          const raw = inspect.view === 'virtual';
          const offset =
            inspect.off.has('sub-pixel offset') || raw ? ([0, 0] as const) : shot.offset;
          lowres.upscale(
            encoder,
            tail.scene.view,
            { offset, filter: raw ? 'raw' : (params.upscale as UpscaleFilter) },
            profiler.pass('upscale'),
          );
        } else {
          view.update(shot.camera, { time: 0, sampling: 'sharp', alphaCut: 0.02 });
          const pass = encoder.beginRenderPass(
            full.pass(tail.scene.view, CLEAR, profiler.pass('full-res')),
          );
          batch.draw(pass, view, { sampleCount: full.sampleCount, coverage: true });
          pass.end();
        }

        // Unlit art straight through, so the low-res path's pixels are exactly the palette's.
        tail.encode(
          encoder,
          target,
          time,
          { exposure: 1, bloom: 0, bloomThreshold: 1, bloomRadius: 0.5 },
          profiler,
          { bloom: false, output: { tonemap: 'none' } },
        );
      },
      stats() {
        return {
          virtual: `${size.width}×${size.height}`,
          scale: size.scale.toFixed(3),
        };
      },
      destroy() {
        view.destroy();
        batch.destroy();
        lowres.destroy();
        full.destroy();
        tail.destroy();
      },
    };
  },
});
