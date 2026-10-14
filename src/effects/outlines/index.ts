import boulder from '../../../assets/sprites/boulder.png?url';
import barrel from '../../../assets/sprites/barrel.png?url';
import chest from '../../../assets/sprites/chest.png?url';
import crystals from '../../../assets/sprites/crystals.png?url';
import knight from '../../../assets/sprites/knight.png?url';
import mage from '../../../assets/sprites/mage.png?url';
import slime from '../../../assets/sprites/slime.png?url';
import traveller from '../../../assets/sprites/traveller.png?url';
import tree from '../../../assets/sprites/tree.png?url';
import cobblestone from '../../../assets/tiles/cobblestone.png?url';
import grass from '../../../assets/tiles/grass.png?url';
import cliff from '../../../assets/walls/cliff.png?url';
import stoneWall from '../../../assets/walls/stone-wall.png?url';
import { loadPixels, packTextureArray, type Pixels } from '../../gpu/assets.ts';
import {
  createOutlinePass,
  createOutlineShade,
  createOutlineTargets,
  OUTLINE_DEPTH_FORMAT,
  outlineSpriteShade,
  type OutlineView,
} from '../../gpu/lighting/outline.ts';
import { pickSprite, type PickBox } from '../../gpu/lighting/outline-pick.ts';
import { trackPointer } from '../../gpu/pointer.ts';
import { createHdrTail } from '../../gpu/post/index.ts';
import { createShader } from '../../gpu/shader.ts';
import { createSpriteBatch, type Sprite } from '../../gpu/sprites/batch.ts';
import { dioramaCamera, framingDistance, type CameraState } from '../../gpu/sprites/camera.ts';
import { createSceneTargets } from '../../gpu/sprites/targets.ts';
import { defaultInspect, defineEffect } from '../types.ts';
import blockShader from './blocks.wgsl';
import { meta } from './meta.ts';

const SHEETS = [
  grass,
  cobblestone,
  traveller,
  mage,
  knight,
  slime,
  chest,
  barrel,
  boulder,
  crystals,
  tree,
];
const [GRASS, COBBLES, TRAVELLER, MAGE, KNIGHT, SLIME, CHEST, BARREL, BOULDER, CRYSTALS, TREE] =
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
const BLOCK_ART = [grass, cliff, cobblestone, stoneWall];
const [TOP_GRASS, SIDE_CLIFF, TOP_COBBLES, SIDE_STONE] = [0, 1, 2, 3];

interface Block extends PickBox {
  top: number;
  side: number;
}

/**
 * Terrain. The terrace at the back gives the two edges only one source can find: its front crease
 * (same object, continuous depth, a right angle: normal only) and its back rim against the floor
 * further back (same object, same up-facing normal, a drop in depth: depth only).
 */
const TERRACE_TOP = 1.25;
const PLINTH_TOP = 0.75;
const BLOCKS: readonly Block[] = [
  { min: [-9, 0, -6.6], max: [1.6, TERRACE_TOP, -3.3], top: TOP_GRASS, side: SIDE_CLIFF },
  { min: [3.3, 0, 1.0], max: [5.5, PLINTH_TOP, 2.8], top: TOP_COBBLES, side: SIDE_STONE },
];

/** A ground tile shows 96 texels: six world units. */
const TILE = 96;
const TILE_SIZE = TILE * (1 / 16);

/** The characters the selection cycles through while nobody is pointing. */
const CAST = ['traveller', 'mage', 'knight'] as const;
const CYCLE_SECONDS = 2.5;

function scene(): { sprites: Sprite[]; names: Map<number, string> } {
  const sprites: Sprite[] = [];
  const names = new Map<number, string>();
  for (const x of [-1, 0, 1]) {
    for (const z of [-2, -1, 0, 1]) {
      sprites.push({
        sheet: x === 0 && z >= 0 ? COBBLES : GRASS,
        position: [x * TILE_SIZE, 0, z * TILE_SIZE + 1],
        facing: 'ground',
        region: [0, 0, TILE, TILE],
      });
    }
  }
  const stand = (name: string, sheet: number, x: number, y: number, z: number, flipX = false) => {
    names.set(sprites.length, name);
    sprites.push({ sheet, position: [x, y, z], flipX });
  };
  stand('tree', TREE, -6.2, TERRACE_TOP, -5.4);
  stand('crystals', CRYSTALS, 0.2, TERRACE_TOP, -4.3);
  stand('knight', KNIGHT, -1.4, 0, -1.9, true);
  stand('chest', CHEST, 2.4, 0, -0.6);
  // A hair in front of the chest and facing the same way: depth and normal barely change across
  // their border, so only the object ID finds it.
  stand('slime', SLIME, 3.0, 0, -0.55);
  stand('mage', MAGE, -4.3, 0, 0.1);
  // In front of the mage, so selecting her shows the x-ray outline through it.
  stand('boulder', BOULDER, -3.9, 0, 1.3);
  stand('barrel', BARREL, 4.4, PLINTH_TOP, 1.9);
  stand('traveller', TRAVELLER, 0.4, 0, 1.4);
  return { sprites, names };
}

const BLOCK_FLOATS = 12;
const BLOCK_UNIFORM_FLOATS = 28;

/** The terrain blocks, drawn into the colour pass and the G-buffer like the sprites. */
function createBlocks(device: GPUDevice, art: readonly Pixels[]) {
  const textures = packTextureArray(device, art, 'outlines blocks');
  const data = new Float32Array(BLOCKS.length * BLOCK_FLOATS);
  BLOCKS.forEach((block, i) => {
    const top = art[block.top]!;
    const side = art[block.side]!;
    data.set(
      [
        ...block.min,
        block.top,
        ...block.max,
        block.side,
        top.width,
        top.height,
        side.width,
        side.height,
      ],
      i * BLOCK_FLOATS,
    );
  });
  const boxes = device.createBuffer({
    label: 'outlines blocks',
    size: data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(boxes, 0, data);

  const layout = device.createBindGroupLayout({
    label: 'outlines blocks',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
      {
        binding: 1,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'read-only-storage' },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { viewDimension: '2d-array', sampleType: 'float' },
      },
    ],
  });
  // One uniform per mode, for the same reason as createOutlineShade: both draws are encoded
  // before either runs.
  const modes = [0, 1].map((mode) => {
    const buffer = device.createBuffer({
      label: `outlines blocks ${mode}`,
      size: BLOCK_UNIFORM_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const group = device.createBindGroup({
      label: `outlines blocks ${mode}`,
      layout,
      entries: [
        { binding: 0, resource: { buffer } },
        { binding: 1, resource: { buffer: boxes } },
        { binding: 2, resource: textures.view },
      ],
    });
    return { mode, buffer, group };
  });
  const module = createShader(device, blockShader);
  const pipeline = device.createRenderPipeline({
    label: 'outlines blocks',
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'vs_block' },
    fragment: { module, entryPoint: 'fs_block', targets: [{ format: 'rgba16float' }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: OUTLINE_DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
  });
  const uniform = new Float32Array(BLOCK_UNIFORM_FLOATS);

  return {
    update(camera: CameraState) {
      for (const { mode, buffer } of modes) {
        uniform.set(camera.viewProj, 0);
        uniform.set([...camera.right, 0, ...camera.up, 0, mode, 0, 0, 0], 16);
        device.queue.writeBuffer(buffer, 0, uniform);
      }
    },
    draw(pass: GPURenderPassEncoder, gbuffer: boolean) {
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, modes[gbuffer ? 1 : 0]!.group);
      pass.draw(30, BLOCKS.length);
    },
    destroy() {
      boxes.destroy();
      textures.texture.destroy();
      for (const { buffer } of modes) buffer.destroy();
    },
  };
}

const NEAR = 0.1;
const FAR = 200;
const SHADER_VIEWS = new Set<string>(['depth', 'normals', 'ids', 'edges']);

export const effect = defineEffect({
  meta,
  params: {
    depthEdges: { type: 'boolean', default: true, label: 'depth edges' },
    normalEdges: { type: 'boolean', default: true, label: 'normal edges' },
    idEdges: { type: 'boolean', default: true, label: 'object edges' },
    depthThreshold: {
      type: 'number',
      default: 0.02,
      min: 0.002,
      max: 0.2,
      step: 0.001,
      label: 'depth threshold',
    },
    normalAngle: {
      type: 'number',
      default: 40,
      min: 5,
      max: 89,
      step: 1,
      label: 'crease angle (degrees)',
    },
    ink: { type: 'color', default: [0.008, 0.006, 0.012], label: 'line colour' },
    inkOpacity: { type: 'number', default: 0.9, min: 0, max: 1, step: 0.01, label: 'line opacity' },
    selection: { type: 'boolean', default: true },
    selectionColor: { type: 'color', default: [1, 0.72, 0.12], label: 'selection colour' },
    hiddenOpacity: {
      type: 'number',
      default: 0.4,
      min: 0,
      max: 1,
      step: 0.01,
      label: 'hidden selection opacity',
    },
    sway: { type: 'number', default: 0, min: 0, max: 0.6, step: 0.01, label: 'camera sway' },
    pitch: { type: 'number', default: 35, min: 10, max: 80, step: 0.5, label: 'camera pitch' },
    fov: { type: 'number', default: 25, min: 10, max: 60, step: 0.5, label: 'field of view' },
  },
  presets: {
    silhouettes: { normalEdges: false, idEdges: false },
    'soft ink': { ink: [0.12, 0.07, 0.05], inkOpacity: 0.45, normalAngle: 30 },
    'selection only': { inkOpacity: 0, sway: 0.15 },
  },
  inspect: {
    views: ['depth', 'normals', 'ids', 'edges'],
    stages: ['depth edges', 'normal edges', 'id edges', 'selection'],
  },

  async create({ device, format, hdr, canvas, params, profiler, inspect = defaultInspect() }) {
    const tail = createHdrTail(device, { format, hdr, label: 'outlines' });
    const [sheets, blockArt] = await Promise.all([
      Promise.all(SHEETS.map((url) => loadPixels(url))),
      Promise.all(BLOCK_ART.map((url) => loadPixels(url))),
    ]);
    const shade = createOutlineShade(device);
    const batch = createSpriteBatch(device, {
      sheets,
      shade: outlineSpriteShade(),
      shadeLayout: shade.layout,
      colorFormat: tail.scene.format,
      depthFormat: OUTLINE_DEPTH_FORMAT,
      label: 'outlines',
    });
    // The selected sprite alone, for its depth mask. A batch holds one list per frame (its
    // instance buffer is rewritten, not appended to), so the selection needs a batch of its own.
    const selectionBatch = createSpriteBatch(device, {
      sheets,
      colorFormat: tail.scene.format,
      depthFormat: OUTLINE_DEPTH_FORMAT,
      maxSprites: 1,
      label: 'outlines selection',
    });
    const view = batch.createView();
    const selectionView = selectionBatch.createView();
    const blocks = createBlocks(device, blockArt);
    const targets = createSceneTargets(device, {
      colorFormat: tail.scene.format,
      depthFormat: OUTLINE_DEPTH_FORMAT,
      label: 'outlines',
    });
    const outlineTargets = createOutlineTargets(device);
    const outlines = createOutlinePass(device, { format: tail.scene.format });
    const pointer = trackPointer(canvas);

    const { sprites, names } = scene();
    batch.setSprites(sprites);
    const cast = CAST.map((name) => [...names].find(([, n]) => n === name)![0]);
    let aspect = 1;
    let selected = -1;

    return {
      resize(width, height) {
        tail.resize(width, height);
        targets.resize(width, height);
        outlineTargets.resize(width, height);
        aspect = width / height;
      },
      frame(time, encoder, target) {
        const distance = framingDistance(params.fov, 10.5);
        const camera = dioramaCamera({
          pitch: params.pitch,
          yaw: 0.32 + params.sway * Math.sin(time.time * 0.35),
          fov: params.fov,
          focus: [0, 1.2, -0.8],
          distance,
          aspect,
          near: NEAR,
          far: FAR,
        });
        // A hard cut-out at sample count 1: the G-buffer, the colour and the selection mask all
        // agree on which pixels a sprite covers, so lines land exactly on its edge.
        view.update(camera, { time: time.time, sampling: 'sharp', alphaCut: 0.5 });
        selectionView.update(camera, { time: time.time, sampling: 'sharp', alphaCut: 0.5 });
        blocks.update(camera);

        // Hover picks; with no pointer over the canvas (and in posters and tests) the selection
        // walks through the cast so the outline is always on show.
        const { state } = pointer;
        selected = state.inside
          ? pickSprite({
              camera,
              x: state.x,
              y: state.y,
              sprites,
              sheets,
              time: time.time,
              occluders: BLOCKS,
            })
          : cast[Math.floor(time.time / CYCLE_SECONDS) % cast.length]!;
        const showSelection = params.selection && !inspect.off.has('selection') && selected >= 0;
        if (showSelection) selectionBatch.setSprites([sprites[selected]!]);

        const colourPass = encoder.beginRenderPass(
          targets.pass(tail.scene.view, [0.045, 0.06, 0.11, 1], profiler.pass('scene')),
        );
        blocks.draw(colourPass, false);
        batch.draw(colourPass, view, { shadeGroup: shade.colour });
        colourPass.end();

        const gbufferPass = encoder.beginRenderPass(
          outlineTargets.gbufferPass(profiler.pass('g-buffer')),
        );
        blocks.draw(gbufferPass, true);
        batch.draw(gbufferPass, view, { shadeGroup: shade.gbuffer });
        gbufferPass.end();

        const maskPass = encoder.beginRenderPass(outlineTargets.selectionPass());
        if (showSelection) {
          selectionBatch.drawDepth(maskPass, selectionView, { depthFormat: OUTLINE_DEPTH_FORMAT });
        }
        maskPass.end();

        const shaderView = SHADER_VIEWS.has(inspect.view) ? (inspect.view as OutlineView) : 'final';
        outlines.encode(encoder, {
          target: tail.scene.view,
          ...outlineTargets.views(),
          selection: showSelection ? outlineTargets.views().selection : undefined,
          settings: {
            depth: params.depthEdges && !inspect.off.has('depth edges'),
            normal: params.normalEdges && !inspect.off.has('normal edges'),
            id: params.idEdges && !inspect.off.has('id edges'),
            depthThreshold: params.depthThreshold,
            normalAngle: params.normalAngle,
            ink: params.ink,
            inkOpacity: params.inkOpacity,
            selectionColor: params.selectionColor,
            hiddenOpacity: params.hiddenOpacity,
            near: NEAR,
            far: FAR,
            view: shaderView,
            depthShown: [distance - 8, distance + 12],
          },
          timestampWrites: profiler.pass('outlines'),
        });

        // Unlit art: no bloom and no tonemapping, so the sprites keep the colours they were drawn in.
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
        return { selected: names.get(selected) ?? 'none' };
      },
      destroy() {
        pointer.destroy();
        view.destroy();
        selectionView.destroy();
        batch.destroy();
        selectionBatch.destroy();
        blocks.destroy();
        shade.destroy();
        targets.destroy();
        outlineTargets.destroy();
        outlines.destroy();
        tail.destroy();
      },
    };
  },
});
