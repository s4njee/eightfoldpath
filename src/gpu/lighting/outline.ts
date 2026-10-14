/*
 * One-pixel outlines from depth, normal and object-ID edges, plus a selection outline (story 3.7).
 *
 *   const targets = createOutlineTargets(device);            // G-buffer, its depth, selection mask
 *   const shade = createOutlineShade(device);                // the batcher's group 2, two modes
 *   const batch = createSpriteBatch(device, { ..., shade: outlineSpriteShade(),
 *     shadeLayout: shade.layout, depthFormat: OUTLINE_DEPTH_FORMAT });
 *   const outlines = createOutlinePass(device, { format: tail.scene.format });
 *   ...each frame:
 *   colour pass:    batch.draw(pass, view, { shadeGroup: shade.colour })
 *   G-buffer pass:  targets.gbufferPass()   → batch.draw(pass, view, { shadeGroup: shade.gbuffer })
 *   selection pass: targets.selectionPass() → selectionBatch.drawDepth(pass, ...)
 *   outlines.encode(encoder, { target: tail.scene.view, ...targets.views(), settings })
 *
 * The batcher has one colour target, so the G-buffer is a second draw of the same batch rather
 * than a second render target of the first. The post pass then marks a pixel when one of its four
 * neighbours differs and it is the nearer of the two; see outline.wgsl for the rule.
 */
import shader from './outline.wgsl';
import spriteGBuffer from '../../wgsl/outline-sprite.wgsl?raw';
import { createShader, withChunks } from '../shader.ts';
import { createUniformBuffer, defineUniformStruct } from '../uniforms.ts';

export const OUTLINE_GBUFFER_FORMAT: GPUTextureFormat = 'rgba16float';
export const OUTLINE_DEPTH_FORMAT: GPUTextureFormat = 'depth32float';
/** Object IDs in the G-buffer's blue channel. Sprite `i` of a batch is `i + 2`. */
export const OUTLINE_SKY_ID = 0;
export const OUTLINE_TERRAIN_ID = 1;
export const outlineSpriteId = (index: number): number => index + 2;

export const OUTLINE_VIEWS = ['final', 'depth', 'normals', 'ids', 'edges'] as const;
export type OutlineView = (typeof OUTLINE_VIEWS)[number];

export interface OutlineSettings {
  /** Which sources draw lines. Default all three. */
  depth?: boolean;
  normal?: boolean;
  id?: boolean;
  /** Draw the selection outline; needs `selection` in `encode`. Default true. */
  selection?: boolean;
  /** A depth step larger than this fraction of the distance is an edge (after the slope test). */
  depthThreshold: number;
  /** Surfaces meeting at more than this many degrees are an edge. */
  normalAngle: number;
  /** Linear RGB of the lines, and their opacity. */
  ink: readonly [number, number, number];
  inkOpacity: number;
  selectionColor: readonly [number, number, number];
  selectionOpacity?: number;
  /** Opacity of the selection outline where the selected object is hidden, relative to visible. */
  hiddenOpacity: number;
  /** The camera's near and far planes, to linearise depth. */
  near: number;
  far: number;
  view?: OutlineView;
  /** Distances shown from white to black by the `depth` view. Default near..far. */
  depthShown?: readonly [number, number];
}

export interface OutlineInputs {
  target: GPUTextureView;
  gbuffer: GPUTextureView;
  depth: GPUTextureView;
  /** The selected object alone, depth only. Without it there is no selection outline. */
  selection?: GPUTextureView;
  settings: OutlineSettings;
  timestampWrites?: GPURenderPassTimestampWrites;
}

export interface OutlinePass {
  /** Blends lines into `target` (load, not clear); debug views overwrite it. */
  encode(encoder: GPUCommandEncoder, inputs: OutlineInputs): void;
  destroy(): void;
}

const Outline = defineUniformStruct('Outline', {
  ink: 'vec4f',
  select_color: 'vec4f',
  // x: depth threshold, y: cosine of the normal angle, z: hidden selection opacity.
  thresholds: 'vec4f',
  // x, y: near and far planes; z, w: the depth view's range.
  depth_range: 'vec4f',
  // x: enabled sources (outline.wgsl SOURCE_*), y: view.
  flags: 'vec4u',
});

export function createOutlinePass(
  device: GPUDevice,
  options: { format: GPUTextureFormat; label?: string },
): OutlinePass {
  const label = options.label ?? 'outline';
  const uniforms = createUniformBuffer(device, Outline, label);
  const layout = device.createBindGroupLayout({
    label,
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'unfilterable-float' },
      },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
    ],
  });
  const module = createShader(device, withChunks(shader, { 'outline-params.wgsl': Outline.wgsl }));
  const pipeline = device.createRenderPipeline({
    label,
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'fullscreen_vs' },
    fragment: {
      module,
      entryPoint: 'fs_outline',
      targets: [
        {
          format: options.format,
          // Straight alpha over the scene; the scene's own alpha stays as it was.
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'zero', dstFactor: 'one' },
          },
        },
      ],
    },
  });

  // Without a selection the shader still needs something bound: a 1x1 mask that is never read,
  // because the selection flag is off.
  const emptyMask = device.createTexture({
    label: `${label} empty selection`,
    size: [1, 1],
    format: OUTLINE_DEPTH_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING,
  });
  const emptyView = emptyMask.createView();

  let bound: { views: GPUTextureView[]; group: GPUBindGroup } | undefined;
  function bindGroup(views: GPUTextureView[]): GPUBindGroup {
    if (bound && bound.views.every((view, i) => view === views[i])) return bound.group;
    const group = device.createBindGroup({
      label,
      layout,
      entries: [
        { binding: 0, resource: { buffer: uniforms.buffer } },
        ...views.map((view, i) => ({ binding: i + 1, resource: view })),
      ],
    });
    bound = { views, group };
    return group;
  }

  return {
    encode(encoder, { target, gbuffer, depth, selection, settings, timestampWrites }) {
      const sources =
        (settings.depth !== false ? 1 : 0) |
        (settings.normal !== false ? 2 : 0) |
        (settings.id !== false ? 4 : 0) |
        (selection && settings.selection !== false ? 8 : 0);
      const shown = settings.depthShown ?? [settings.near, settings.far];
      uniforms.set({
        ink: [...settings.ink, settings.inkOpacity],
        select_color: [...settings.selectionColor, settings.selectionOpacity ?? 1],
        thresholds: [
          settings.depthThreshold,
          Math.cos((settings.normalAngle * Math.PI) / 180),
          settings.hiddenOpacity,
          0,
        ],
        depth_range: [settings.near, settings.far, shown[0], shown[1]],
        flags: [sources, OUTLINE_VIEWS.indexOf(settings.view ?? 'final'), 0, 0],
      });
      uniforms.upload();

      const pass = encoder.beginRenderPass({
        label,
        colorAttachments: [{ view: target, loadOp: 'load', storeOp: 'store' }],
        timestampWrites,
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup([gbuffer, depth, selection ?? emptyView]));
      pass.draw(3);
      pass.end();
    },
    destroy() {
      uniforms.destroy();
      emptyMask.destroy();
    },
  };
}

export interface OutlineTargets {
  readonly gbuffer: GPUTexture;
  readonly depth: GPUTexture;
  readonly selection: GPUTexture;
  /** Views for `OutlinePass.encode`. Recreated on resize, so read them every frame. */
  views(): { gbuffer: GPUTextureView; depth: GPUTextureView; selection: GPUTextureView };
  resize(width: number, height: number): void;
  /** Clears the G-buffer to sky (ID 0) and its depth to the far plane. */
  gbufferPass(timestampWrites?: GPURenderPassTimestampWrites): GPURenderPassDescriptor;
  /** Depth only: draw the selected object here, or nothing for no selection. */
  selectionPass(timestampWrites?: GPURenderPassTimestampWrites): GPURenderPassDescriptor;
  destroy(): void;
}

/** The G-buffer, its depth and the selection mask, at sample count 1 (outlines need hard edges). */
export function createOutlineTargets(device: GPUDevice, label = 'outline'): OutlineTargets {
  let width = 1;
  let height = 1;
  let textures: { gbuffer: GPUTexture; depth: GPUTexture; selection: GPUTexture } | undefined;
  let views: ReturnType<OutlineTargets['views']> | undefined;

  function allocate() {
    destroy();
    const make = (name: string, format: GPUTextureFormat) =>
      device.createTexture({
        label: `${label} ${name}`,
        size: [width, height],
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
    textures = {
      gbuffer: make('g-buffer', OUTLINE_GBUFFER_FORMAT),
      depth: make('depth', OUTLINE_DEPTH_FORMAT),
      selection: make('selection', OUTLINE_DEPTH_FORMAT),
    };
    views = {
      gbuffer: textures.gbuffer.createView(),
      depth: textures.depth.createView(),
      selection: textures.selection.createView(),
    };
  }
  function destroy() {
    textures?.gbuffer.destroy();
    textures?.depth.destroy();
    textures?.selection.destroy();
  }
  allocate();

  return {
    get gbuffer() {
      return textures!.gbuffer;
    },
    get depth() {
      return textures!.depth;
    },
    get selection() {
      return textures!.selection;
    },
    views: () => views!,
    resize(nextWidth, nextHeight) {
      nextWidth = Math.max(1, nextWidth);
      nextHeight = Math.max(1, nextHeight);
      if (nextWidth === width && nextHeight === height) return;
      width = nextWidth;
      height = nextHeight;
      allocate();
    },
    gbufferPass: (timestampWrites) => ({
      label: `${label} g-buffer`,
      colorAttachments: [
        { view: views!.gbuffer, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
      ],
      depthStencilAttachment: {
        view: views!.depth,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
        depthClearValue: 1,
      },
      timestampWrites,
    }),
    selectionPass: (timestampWrites) => ({
      label: `${label} selection`,
      colorAttachments: [],
      depthStencilAttachment: {
        view: views!.selection,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
        depthClearValue: 1,
      },
      timestampWrites,
    }),
    destroy,
  };
}

/** WGSL defining `fn outline_gbuffer(f: SpriteFragment) -> vec3f`, for a batcher shade chunk. */
export const OUTLINE_SPRITE_WGSL: string = spriteGBuffer;

/**
 * A batcher `shade` chunk that draws colour or the outline G-buffer, chosen by its group 2
 * uniform (`createOutlineShade`). `colour` is the body of `fn sprite_colour(f: SpriteFragment)
 * -> vec3f`; the default is the art, unlit. The chunk owns group 2, so a colour body cannot bring
 * bindings of its own.
 */
export function outlineSpriteShade(colour = 'return f.color.rgb;'): string {
  return `${OUTLINE_SPRITE_WGSL}
// x: 1 draws the outline G-buffer instead of colour.
@group(2) @binding(0) var<uniform> outline_mode: vec4f;

fn sprite_colour(f: SpriteFragment) -> vec3f {
  ${colour}
}

fn sprite_shade(f: SpriteFragment) -> vec3f {
  if (outline_mode.x > 0.5) {
    return outline_gbuffer(f);
  }
  return sprite_colour(f);
}
`;
}

export interface OutlineShade {
  readonly layout: GPUBindGroupLayout;
  /** Pass as `shadeGroup` to draw colour. */
  readonly colour: GPUBindGroup;
  /** Pass as `shadeGroup` to draw the G-buffer. Keep the sprites' tint white and flash 0. */
  readonly gbuffer: GPUBindGroup;
  destroy(): void;
}

/**
 * Two fixed bind groups rather than one uniform rewritten between draws: both draws are encoded
 * before the queue runs, so a rewrite would leave only the last value for both.
 */
export function createOutlineShade(device: GPUDevice, label = 'outline shade'): OutlineShade {
  const layout = device.createBindGroupLayout({
    label,
    entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {} }],
  });
  const buffers = [0, 1].map((mode) => {
    const buffer = device.createBuffer({
      label: `${label} ${mode}`,
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, new Float32Array([mode, 0, 0, 0]));
    return buffer;
  });
  const group = (buffer: GPUBuffer) =>
    device.createBindGroup({ label, layout, entries: [{ binding: 0, resource: { buffer } }] });
  return {
    layout,
    colour: group(buffers[0]!),
    gbuffer: group(buffers[1]!),
    destroy: () => buffers.forEach((buffer) => buffer.destroy()),
  };
}
