/*
 * The tile extruder on the GPU (story 4.2): a scene's terrain in one draw call.
 *
 *   const terrain = createTerrain(device, { scene, art, shade, shadeLayout, colorFormat });
 *   ...each frame, in the scene pass, with the sprite batcher's view:
 *   terrain.draw(pass, view, { sampleCount: 4, shadeGroup });
 *   ...and into a shadow map:
 *   terrain.drawDepth(pass, lightView, { depthFormat: shadow.format });
 *
 * `extrude.ts` lays the scene out as boxes; this packs them into a storage buffer with the art in
 * one texture array and draws 30 vertices per box. The view is the sprite batcher's
 * (`batch.createView()`), so terrain and sprites share a camera and a depth buffer.
 */
import { packTextureArray, type Pixels } from '../assets.ts';
import { createShader, withChunks } from '../shader.ts';
import type { SpriteView } from '../sprites/batch.ts';
import { extrude, packBoxes, type Box } from './extrude.ts';
import type { Scene } from './scene.ts';
import shader from './terrain.wgsl';

export interface TerrainOptions {
  scene: Scene;
  /** The image for every art name the terrain uses (`scene.kinds`' tops and sides). */
  art: Readonly<Record<string, Pixels>>;
  /** WGSL defining `fn terrain_shade(f: TerrainFragment) -> vec3f`. Default: the art, unlit. */
  shade?: string;
  /** Bindings the shade chunk declares in group 2. */
  shadeLayout?: GPUBindGroupLayout;
  colorFormat: GPUTextureFormat;
  /** Default `depth24plus`. */
  depthFormat?: GPUTextureFormat;
  label?: string;
}

export interface TerrainSettings {
  /** Texels over which tops of different art are dithered together. 0 for hard seams. */
  dither?: number;
  /** How much brighter a top's edge is above a drop, 0 for none. */
  rim?: number;
  /** Width of that rim in texels. */
  rimWidth?: number;
}

export interface Terrain {
  readonly boxes: readonly Box[];
  /** Faces drawn per frame, collapsed ones included: five per box. */
  readonly faces: number;
  update(settings: TerrainSettings): void;
  draw(
    pass: GPURenderPassEncoder,
    view: SpriteView,
    options?: { sampleCount?: number; shadeGroup?: GPUBindGroup },
  ): void;
  drawDepth(
    pass: GPURenderPassEncoder,
    view: SpriteView,
    options: { depthFormat: GPUTextureFormat; sampleCount?: number },
  ): void;
  destroy(): void;
}

const UNLIT = 'fn terrain_shade(f: TerrainFragment) -> vec3f {\n  return f.color;\n}\n';
const VERTICES_PER_BOX = 30;

export function createTerrain(device: GPUDevice, options: TerrainOptions): Terrain {
  const label = options.label ?? 'terrain';
  const depthFormat = options.depthFormat ?? 'depth24plus';
  const { scene } = options;
  const names = [...new Set(scene.kinds.flatMap((kind) => [kind.top, kind.side]))].sort();
  const missing = names.filter((name) => !options.art[name]);
  if (missing.length) throw new Error(`createTerrain: no image for ${missing.join(', ')}`);
  const packed = packTextureArray(
    device,
    names.map((name) => options.art[name]!),
    `${label} art`,
  );
  const layerOf = (name: string) => names.indexOf(name);

  const boxes = extrude(scene);
  const data = packBoxes(boxes, layerOf);
  const boxBuffer = device.createBuffer({
    label: `${label} boxes`,
    size: Math.max(data.byteLength, 80),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(boxBuffer, 0, data);
  const sizes = new Float32Array(names.length * 4);
  packed.layers.forEach((layer, i) => sizes.set([layer.width, layer.height], i * 4));
  const sizeBuffer = device.createBuffer({
    label: `${label} layer sizes`,
    size: sizes.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(sizeBuffer, 0, sizes);
  const settingsBuffer = device.createBuffer({
    label: `${label} settings`,
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // The same layout as the sprite batcher's view, so its views bind here too.
  const viewLayout = device.createBindGroupLayout({
    label: `${label} view`,
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
    ],
  });
  const resourceLayout = device.createBindGroupLayout({
    label: `${label} resources`,
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'read-only-storage' },
      },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: '2d-array' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
    ],
  });
  const resources = device.createBindGroup({
    label: `${label} resources`,
    layout: resourceLayout,
    entries: [
      { binding: 0, resource: { buffer: boxBuffer } },
      { binding: 1, resource: packed.view },
      {
        binding: 2,
        resource: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }),
      },
      { binding: 3, resource: { buffer: sizeBuffer } },
      { binding: 4, resource: { buffer: settingsBuffer } },
    ],
  });
  const module = createShader(
    device,
    withChunks(shader, { 'terrain-shade.wgsl': options.shade ?? UNLIT }),
  );
  const layout = device.createPipelineLayout({
    label,
    bindGroupLayouts: options.shadeLayout
      ? [viewLayout, resourceLayout, options.shadeLayout]
      : [viewLayout, resourceLayout],
  });

  const colorPipelines = new Map<number, GPURenderPipeline>();
  function colorPipeline(sampleCount: number): GPURenderPipeline {
    let pipeline = colorPipelines.get(sampleCount);
    if (!pipeline) {
      pipeline = device.createRenderPipeline({
        label: `${label} ${sampleCount}x`,
        layout,
        vertex: { module, entryPoint: 'vs_terrain' },
        fragment: { module, entryPoint: 'fs_terrain', targets: [{ format: options.colorFormat }] },
        // Collapsed faces and back faces cost nothing to keep; culling would need every face's
        // winding checked against slopes, for little gain.
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'less' },
        multisample: { count: sampleCount },
      });
      colorPipelines.set(sampleCount, pipeline);
    }
    return pipeline;
  }
  const depthPipelines = new Map<string, GPURenderPipeline>();
  function depthPipeline(format: GPUTextureFormat, sampleCount: number): GPURenderPipeline {
    const key = `${format}/${sampleCount}`;
    let pipeline = depthPipelines.get(key);
    if (!pipeline) {
      pipeline = device.createRenderPipeline({
        label: `${label} depth ${key}`,
        layout: device.createPipelineLayout({ bindGroupLayouts: [viewLayout, resourceLayout] }),
        vertex: { module, entryPoint: 'vs_terrain' },
        fragment: { module, entryPoint: 'fs_depth', targets: [] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format, depthWriteEnabled: true, depthCompare: 'less' },
        multisample: { count: sampleCount },
      });
      depthPipelines.set(key, pipeline);
    }
    return pipeline;
  }

  const terrain: Terrain = {
    boxes,
    faces: boxes.length * 5,
    update(settings) {
      device.queue.writeBuffer(
        settingsBuffer,
        0,
        new Float32Array([settings.dither ?? 3, settings.rim ?? 0.25, settings.rimWidth ?? 1, 0]),
      );
    },
    draw(pass, view, drawOptions = {}) {
      if (!boxes.length) return;
      pass.setPipeline(colorPipeline(drawOptions.sampleCount ?? 1));
      pass.setBindGroup(0, view.bindGroup);
      pass.setBindGroup(1, resources);
      if (drawOptions.shadeGroup) pass.setBindGroup(2, drawOptions.shadeGroup);
      pass.draw(VERTICES_PER_BOX, boxes.length);
    },
    drawDepth(pass, view, drawOptions) {
      if (!boxes.length) return;
      pass.setPipeline(depthPipeline(drawOptions.depthFormat, drawOptions.sampleCount ?? 1));
      pass.setBindGroup(0, view.bindGroup);
      pass.setBindGroup(1, resources);
      pass.draw(VERTICES_PER_BOX, boxes.length);
    },
    destroy() {
      boxBuffer.destroy();
      sizeBuffer.destroy();
      settingsBuffer.destroy();
      packed.texture.destroy();
    },
  };
  terrain.update({});
  return terrain;
}
