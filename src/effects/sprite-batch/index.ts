import barrel from '../../../assets/sprites/barrel.png?url';
import boulder from '../../../assets/sprites/boulder.png?url';
import chest from '../../../assets/sprites/chest.png?url';
import knight from '../../../assets/sprites/knight.png?url';
import lantern from '../../../assets/sprites/lantern.png?url';
import mage from '../../../assets/sprites/mage.png?url';
import slimeBounce from '../../../assets/sprites/slime-bounce.png?url';
import traveller from '../../../assets/sprites/traveller.png?url';
import tree from '../../../assets/sprites/tree.png?url';
import cobblestone from '../../../assets/tiles/cobblestone.png?url';
import grass from '../../../assets/tiles/grass.png?url';
import { loadPixels } from '../../gpu/assets.ts';
import { createHdrTail } from '../../gpu/post/index.ts';
import {
  createSpriteBatch,
  SAMPLING_MODES,
  TEXEL,
  type Facing,
  type SamplingMode,
  type Sprite,
} from '../../gpu/sprites/batch.ts';
import { dioramaCamera, framingDistance } from '../../gpu/sprites/camera.ts';
import { createSceneTargets } from '../../gpu/sprites/targets.ts';
import { defaultInspect, defineEffect } from '../types.ts';
import { meta } from './meta.ts';

const SHEETS = [
  cobblestone,
  grass,
  traveller,
  mage,
  knight,
  slimeBounce,
  lantern,
  barrel,
  chest,
  tree,
  boulder,
];
const [COBBLES, GRASS, TRAVELLER, MAGE, KNIGHT, SLIME, LANTERN, BARREL, CHEST, TREE, BOULDER] =
  SHEETS.map((_, index) => index) as number[] as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];

/** Each ground tile shows 96 texels: six world units. */
const TILE = 96;
const TILE_SIZE = TILE * TEXEL;

/** The cast, standing on the cobbles and the grass beside them, sorted back to front only for reading. */
function scene(facing: Facing, fps: number, flashing: boolean, time: number): Sprite[] {
  const stand = (sheet: number, x: number, z: number, extra: Partial<Sprite> = {}): Sprite => ({
    sheet,
    position: [x, 0, z],
    facing,
    ...extra,
  });
  // A hit flash that lands halfway through each second and fades over a fifth of it, so the
  // first frame (and the poster) shows the slime itself.
  const phase = (time % 1) - 0.5;
  const flash = flashing && phase >= 0 ? Math.max(0, 1 - phase * 5) : 0;
  return [
    { sheet: COBBLES, position: [0, 0, 0], facing: 'ground', region: [0, 0, TILE, TILE] },
    {
      sheet: GRASS,
      position: [-TILE_SIZE, 0, 0],
      facing: 'ground',
      region: [0, 0, TILE, TILE],
    },
    {
      sheet: GRASS,
      position: [TILE_SIZE, 0, 0],
      facing: 'ground',
      region: [0, 0, TILE, TILE],
    },
    stand(TREE, -6.5, -1.5),
    stand(BOULDER, 5.4, -1.2),
    stand(LANTERN, -2.4, -2.2),
    stand(BARREL, 2.3, -2.3),
    stand(CHEST, 1.2, -1.6),
    stand(MAGE, -1.6, 0.6),
    stand(KNIGHT, 1.8, 0.4, { flipX: true }),
    stand(TRAVELLER, -0.2, 1.2),
    stand(SLIME, 0.9, 2.0, { region: [0, 0, 30, 66], frames: 4, fps, flash }),
  ];
}

export const effect = defineEffect({
  meta,
  params: {
    sampling: { type: 'select', default: 'sharp', options: SAMPLING_MODES },
    cutout: {
      type: 'select',
      default: 'alpha-to-coverage',
      options: ['hard', 'alpha-to-coverage'],
      label: 'cut-out edge',
    },
    facing: { type: 'select', default: 'upright', options: ['upright', 'camera'] },
    orbit: { type: 'number', default: 0.12, min: -1, max: 1, step: 0.01, label: 'orbit speed' },
    flipbookFps: { type: 'number', default: 6, min: 0, max: 24, step: 1, label: 'flipbook fps' },
    hitFlash: { type: 'boolean', default: true, label: 'hit flash' },
    pitch: { type: 'number', default: 35, min: 5, max: 85, step: 0.5, label: 'camera pitch' },
    fov: { type: 'number', default: 25, min: 10, max: 60, step: 0.5, label: 'field of view' },
  },
  presets: {
    'crisp but crawling': { sampling: 'nearest', cutout: 'hard', orbit: 0.3 },
    'soft and blurred': { sampling: 'bilinear', cutout: 'alpha-to-coverage', orbit: 0.3 },
    'camera-facing': { facing: 'camera', pitch: 60 },
  },
  inspect: { stages: ['antialiasing', 'animation'] },

  async create({ device, format, hdr, params, profiler, inspect = defaultInspect() }) {
    const tail = createHdrTail(device, { format, hdr, label: 'sprite-batch' });
    const sheets = await Promise.all(SHEETS.map((url) => loadPixels(url)));
    const batch = createSpriteBatch(device, {
      sheets,
      colorFormat: tail.scene.format,
      label: 'sprite-batch',
    });
    const view = batch.createView();
    const targets = createSceneTargets(device, { colorFormat: tail.scene.format });
    let aspect = 1;
    let yaw = 0.25;
    let clock = 0;

    return {
      resize(width, height) {
        tail.resize(width, height);
        targets.resize(width, height);
        aspect = width / height;
      },
      frame(time, encoder, target) {
        yaw += time.delta * params.orbit;
        // The animation stage holds the flipbook and the flash, so the before/after split can
        // compare the same frame.
        if (!inspect.off.has('animation')) clock += time.delta;
        const antialiased = !inspect.off.has('antialiasing');
        const coverage = antialiased && params.cutout === 'alpha-to-coverage';
        targets.setSampleCount(coverage ? 4 : 1);

        batch.setSprites(
          scene(params.facing as Facing, params.flipbookFps, params.hitFlash, clock),
        );
        view.update(
          dioramaCamera({
            pitch: params.pitch,
            yaw,
            fov: params.fov,
            focus: [0, 1, 0],
            distance: framingDistance(params.fov, 9),
            aspect,
          }),
          {
            time: clock,
            sampling: antialiased ? (params.sampling as SamplingMode) : 'nearest',
            alphaCut: coverage ? 0.02 : 0.5,
          },
        );

        const pass = encoder.beginRenderPass(
          targets.pass(tail.scene.view, [0.03, 0.035, 0.07, 1], profiler.pass('sprites')),
        );
        batch.draw(pass, view, { sampleCount: targets.sampleCount, coverage });
        pass.end();

        // Unlit art: no bloom and no tonemapping, so the sprites keep the colours they were drawn in.
        tail.encode(
          encoder,
          target,
          time,
          { exposure: 1, bloom: 0, bloomThreshold: 1, bloomRadius: 0.5 },
          profiler,
          { bloom: false, output: { tonemap: 'none', dither: 0 } },
        );
      },
      destroy() {
        view.destroy();
        batch.destroy();
        targets.destroy();
        tail.destroy();
      },
    };
  },
});
