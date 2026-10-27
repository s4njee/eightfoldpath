/*
 * Story 5.1's study scene (experiments/tilt-shift-study.test.ts): a lantern-lit street receding
 * from the camera, built with the sprite batcher before the diorama kit (Epic 4) existed. It is
 * deeper than the village the `tilt-shift` effect now shows, about 5 units of ground in front of
 * the focus and 18 behind, which makes it the harder case for comparing the two lenses, so the
 * study keeps it. `draw` fills an HDR colour target and a depth buffer.
 *
 * Ground tiles run from under the camera to past the top of the frame, with rows of characters,
 * props and trees at every depth, a tall tree in the near corner, and lanterns along both sides
 * whose glass glows several times brighter than white, so the lens has small bright lights to blur
 * and the bloom after it has something to catch.
 */
import barrel from '../assets/sprites/barrel.png?url';
import boulder from '../assets/sprites/boulder.png?url';
import chest from '../assets/sprites/chest.png?url';
import crystals from '../assets/sprites/crystals.png?url';
import knight from '../assets/sprites/knight.png?url';
import lantern from '../assets/sprites/lantern.png?url';
import mage from '../assets/sprites/mage.png?url';
import slime from '../assets/sprites/slime.png?url';
import traveller from '../assets/sprites/traveller.png?url';
import tree from '../assets/sprites/tree.png?url';
import cobblestone from '../assets/tiles/cobblestone.png?url';
import grass from '../assets/tiles/grass.png?url';
import { loadPixels } from '../src/gpu/assets.ts';
import { createSpriteBatch, TEXEL, type Sprite } from '../src/gpu/sprites/batch.ts';
import { dioramaCamera, type CameraState } from '../src/gpu/sprites/camera.ts';
import { createUniformBuffer, defineUniformStruct, uniformArray } from '../src/gpu/uniforms.ts';
import shadeBody from './tilt-shift-street.wgsl?raw';

/** The art, in texture-array order; the constants below are indices into it. */
const SHEETS = [
  grass,
  cobblestone,
  traveller,
  knight,
  mage,
  tree,
  lantern,
  barrel,
  chest,
  boulder,
  crystals,
  slime,
];
const GRASS = 0;
const COBBLE = 1;
const TRAVELLER = 2;
const KNIGHT = 3;
const MAGE = 4;
const TREE = 5;
const LANTERN = 6;
const BARREL = 7;
const CHEST = 8;
const BOULDER = 9;
const CRYSTALS = 10;
const SLIME = 11;

const MAX_LIGHTS = 12;
const SceneShade = defineUniformStruct('SceneShade', {
  glow: 'f32',
  lantern_layer: 'f32',
  light_count: 'f32',
  lights: uniformArray('vec4f', MAX_LIGHTS),
});

/** Ground tiles show 96 texels: six world units. */
const TILE = 96;
const TILE_SIZE = TILE * TEXEL;
/** Lanterns stand either side of the street, one every six units. */
const LANTERN_X = 3.7;
const LANTERN_ROWS = [5, -1, -7, -13, -19];
/** Where the lanterns' glass is in their sheet, texels from the top; the light hangs there. */
const GLASS_HEIGHT = 83 - 21;

/** Who stands where: sheet, feet x and z, and whether the sprite is mirrored. */
const CAST: readonly (readonly [number, number, number, boolean?])[] = [
  // The subject, at the camera's focus point.
  [TRAVELLER, -0.8, 0],
  [MAGE, 1.6, 0.6, true],
  [SLIME, 0.4, 1.8],
  // Nearer: a knight and props in front of the focus.
  [KNIGHT, 1.8, 5.2, true],
  [BARREL, -2.2, 4.4],
  [CHEST, -1.0, 6.2],
  // Further back, every few units, out to the top of the frame.
  [KNIGHT, -1.6, -4.5],
  [BARREL, 2.4, -4],
  [TRAVELLER, 1.2, -9, true],
  [CRYSTALS, -2.4, -10],
  [MAGE, -0.6, -14],
  [BOULDER, 2.6, -15.5],
  [KNIGHT, 0.8, -20, true],
  [TRAVELLER, -1.8, -23],
];
/** Trees line the grass on both sides; one stands in the near corner, the classic foreground. */
const TREES: readonly (readonly [number, number])[] = [
  [-6.4, 7.5],
  [7.5, 3],
  [-8.5, 1],
  [6.2, -3.5],
  [-6.8, -6],
  [8.8, -9],
  [-7.8, -12],
  [6.6, -16],
  [-6.5, -19],
  [8.4, -22],
  [-8.2, -25],
];

/** The camera stands this far from the subject; it is the default focus distance. */
export const CAMERA_DISTANCE = 30;

/** plan.md's diorama camera (pitch 35°, field of view 25°), framed on the subject. */
export function standInCamera(
  aspect: number,
  { pitch = 35, yaw = 0.12, fov = 25 }: { pitch?: number; yaw?: number; fov?: number } = {},
): CameraState {
  return dioramaCamera({
    pitch,
    yaw,
    fov,
    focus: [0, 1.5, 0],
    distance: CAMERA_DISTANCE,
    aspect,
    // A near plane of 1 rather than 0.1 keeps depth24plus precise across the street.
    near: 1,
    far: 150,
  });
}

export interface StandInScene {
  /** Lights in world space, for focusing on: each lantern's glass. */
  readonly lights: readonly (readonly [number, number, number])[];
  /** Draws the diorama into a pass that has the HDR colour target and the depth buffer. */
  draw(
    pass: GPURenderPassEncoder,
    camera: CameraState,
    options: { time: number; sampleCount: number; glow: number },
  ): void;
  destroy(): void;
}

export async function createStandInScene(
  device: GPUDevice,
  options: { colorFormat: GPUTextureFormat; label: string },
): Promise<StandInScene> {
  const art = await Promise.all(SHEETS.map((url) => loadPixels(url)));
  const lights = LANTERN_ROWS.flatMap((z) =>
    [-LANTERN_X, LANTERN_X].map((x) => [x, GLASS_HEIGHT * TEXEL, z] as const),
  );
  const uniforms = createUniformBuffer(device, SceneShade, `${options.label} shade`);
  uniforms.set({
    lantern_layer: LANTERN,
    light_count: lights.length,
    lights: lights.flatMap((light) => [...light, 0]),
  });
  const shadeLayout = device.createBindGroupLayout({
    label: `${options.label} shade`,
    entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {} }],
  });
  const shadeGroup = device.createBindGroup({
    layout: shadeLayout,
    entries: [{ binding: 0, resource: { buffer: uniforms.buffer } }],
  });
  const batch = createSpriteBatch(device, {
    sheets: art,
    shade: `${SceneShade.wgsl}\n${shadeBody}`,
    shadeLayout,
    colorFormat: options.colorFormat,
    label: options.label,
  });
  const view = batch.createView();

  const sprites: Sprite[] = [];
  // The street: cobbles down the middle column, grass either side.
  for (let column = -3; column <= 3; column++) {
    for (let row = 0; row < 7; row++) {
      sprites.push({
        sheet: column === 0 ? COBBLE : GRASS,
        position: [column * TILE_SIZE, 0, 9 - (row + 0.5) * TILE_SIZE],
        facing: 'ground',
        region: [0, 0, TILE, TILE],
      });
    }
  }
  for (const z of LANTERN_ROWS) {
    for (const x of [-LANTERN_X, LANTERN_X]) {
      sprites.push({ sheet: LANTERN, position: [x, 0, z] });
    }
  }
  for (const [x, z] of TREES) sprites.push({ sheet: TREE, position: [x, 0, z], flipX: x > 0 });
  for (const [sheet, x, z, flipX] of CAST) sprites.push({ sheet, position: [x, 0, z], flipX });
  batch.setSprites(sprites);

  return {
    lights,
    draw(pass, camera, { time, sampleCount, glow: strength }) {
      uniforms.set({ glow: strength });
      uniforms.upload();
      view.update(camera, { time, sampling: 'sharp', alphaCut: sampleCount > 1 ? 0.02 : 0.5 });
      batch.draw(pass, view, { sampleCount, coverage: sampleCount > 1, shadeGroup });
    },
    destroy() {
      view.destroy();
      batch.destroy();
      uniforms.destroy();
    },
  };
}
