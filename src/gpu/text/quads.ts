import { createShader, withChunks } from '../shader.ts';
import { createUniformBuffer, defineUniformStruct } from '../uniforms.ts';
import type { TextLayout } from './layout.ts';
import shader from './pixel-quads.wgsl';

/*
 * A renderer for screen-space pixel art: text, frames and panels drawn at whole-number scales
 * (story 3.10). Every quad copies a rectangle of a texture-array layer to a rectangle of the
 * screen, one texel per `scale` × `scale` pixels, repeating the source when the destination is
 * larger: a nine-slice frame is nine quads whose edges and centre tile rather than stretch, so
 * the frame stays crisp at any size. One instanced draw for everything.
 *
 *   const quads = createPixelQuads(device, { format, art: textureArray.view });
 *   quads.set([...textQuads(layoutText(atlas, 'Hello'), { x, y, scale, layer, tint }), ...]);
 *   quads.draw(pass, { width, height, reveal });
 */

const Params = defineUniformStruct('Params', {
  viewport: 'vec2f',
  reveal: 'f32',
  debug: 'f32',
});

const QUAD_FLOATS = 16;

export interface PixelQuad {
  /** Destination top-left and size, in target pixels. Keep them integers for crisp texels. */
  dst: readonly [number, number, number, number];
  /** Source rectangle in texels of `layer`; repeated to fill `dst`. */
  src: readonly [number, number, number, number];
  layer: number;
  /** Pixels per texel; a whole number. */
  scale: number;
  /** Linear colour multiplier. Default white. */
  tint?: readonly [number, number, number];
  /** Typewriter order: hidden until the reveal clock passes it. Default: always shown. */
  order?: number;
}

export interface PixelQuadsOptions {
  format: GPUTextureFormat;
  /** A `2d-array` view of the art, e.g. `packTextureArray(...).view`. */
  art: GPUTextureView;
  /** Quads the buffer holds before it has to grow. Default 1024. */
  capacity?: number;
  label?: string;
}

export interface DrawOptions {
  width: number;
  height: number;
  /** Glyphs whose order is below this are shown. Default: all. */
  reveal?: number;
  /** Fill each quad with a flat colour of its own, to show the quads themselves. */
  debug?: boolean;
}

export interface PixelQuads {
  set(quads: readonly PixelQuad[]): void;
  draw(pass: GPURenderPassEncoder, options: DrawOptions): void;
  destroy(): void;
}

export function createPixelQuads(device: GPUDevice, options: PixelQuadsOptions): PixelQuads {
  const label = options.label ?? 'pixel quads';
  const uniforms = createUniformBuffer(device, Params, `${label} params`);
  const module = createShader(device, withChunks(shader, { 'params.wgsl': Params.wgsl }));
  const layout = device.createBindGroupLayout({
    label,
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
        texture: { viewDimension: '2d-array' },
      },
    ],
  });
  const pipeline = device.createRenderPipeline({
    label,
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format: options.format }] },
  });

  let capacity = 0;
  let buffer: GPUBuffer | undefined;
  let bindGroup: GPUBindGroup | undefined;
  let count = 0;
  let data = new Float32Array(0);

  const grow = (needed: number) => {
    if (needed <= capacity && buffer) return;
    capacity = Math.max(needed, options.capacity ?? 1024, capacity * 2);
    buffer?.destroy();
    buffer = device.createBuffer({
      label: `${label} quads`,
      size: capacity * QUAD_FLOATS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    data = new Float32Array(capacity * QUAD_FLOATS);
    bindGroup = device.createBindGroup({
      label,
      layout,
      entries: [
        { binding: 0, resource: { buffer: uniforms.buffer } },
        { binding: 1, resource: { buffer } },
        { binding: 2, resource: options.art },
      ],
    });
  };
  grow(1);

  return {
    set(quads) {
      grow(quads.length);
      quads.forEach((quad, i) => {
        const tint = quad.tint ?? [1, 1, 1];
        data.set(
          [
            ...quad.dst,
            ...quad.src,
            tint[0],
            tint[1],
            tint[2],
            quad.order ?? -1,
            quad.layer,
            quad.scale,
            i,
            0,
          ],
          i * QUAD_FLOATS,
        );
      });
      count = quads.length;
      if (count > 0) device.queue.writeBuffer(buffer!, 0, data, 0, count * QUAD_FLOATS);
    },
    draw(pass, { width, height, reveal = Infinity, debug = false }) {
      if (count === 0) return;
      uniforms.set({
        viewport: [width, height],
        // A uniform cannot hold Infinity portably; past any real order is enough.
        reveal: Math.min(reveal, 1e9),
        debug: debug ? 1 : 0,
      });
      uniforms.upload();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup!);
      pass.draw(6, count);
    },
    destroy() {
      buffer?.destroy();
      uniforms.destroy();
    },
  };
}

export interface TextQuadOptions {
  /** Top-left of the text block, in target pixels. */
  x: number;
  y: number;
  /** Pixels per font texel. */
  scale: number;
  /** Layer of the atlas in the texture array. */
  layer: number;
  tint?: readonly [number, number, number];
  /** A copy one texel down and right, drawn first, in this colour. */
  shadow?: readonly [number, number, number];
  /** Added to every glyph's typewriter order; leave out to always show the text. */
  orderOffset?: number;
}

/** Quads for a laid-out text block: its shadow first, if any, then the glyphs. */
export function textQuads(text: TextLayout, options: TextQuadOptions): PixelQuad[] {
  const { x, y, scale, layer } = options;
  const quad = (
    glyph: TextLayout['glyphs'][number],
    dx: number,
    tint: readonly [number, number, number] | undefined,
  ): PixelQuad => ({
    dst: [
      x + (glyph.x + dx) * scale,
      y + (glyph.y + dx) * scale,
      glyph.glyph.width * scale,
      glyph.glyph.height * scale,
    ],
    src: [glyph.glyph.x, glyph.glyph.y, glyph.glyph.width, glyph.glyph.height],
    layer,
    scale,
    tint,
    order: options.orderOffset === undefined ? undefined : options.orderOffset + glyph.order,
  });
  return [
    ...(options.shadow ? text.glyphs.map((glyph) => quad(glyph, 1, options.shadow)) : []),
    ...text.glyphs.map((glyph) => quad(glyph, 0, options.tint)),
  ];
}

export interface NineSlice {
  /** Insets of the corners in texels: left, top, right, bottom. */
  readonly insets: readonly [number, number, number, number];
  readonly width: number;
  readonly height: number;
}

/**
 * Nine quads that draw a frame image at any size: corners as they are, edges and centre repeated.
 * `x`, `y`, `width` and `height` are in texels of the frame; the result is scaled by `scale`.
 * With `centre` false the middle is left out, so whatever is behind the frame shows through it.
 */
export function nineSliceQuads(
  frame: NineSlice,
  layer: number,
  rect: readonly [number, number, number, number],
  scale: number,
  tint?: readonly [number, number, number],
  centre = true,
): PixelQuad[] {
  const [left, top, right, bottom] = frame.insets;
  const [x, y, w, h] = rect;
  const midW = frame.width - left - right;
  const midH = frame.height - top - bottom;
  const columns = [
    [0, left, x, left],
    [left, midW, x + left, w - left - right],
    [frame.width - right, right, x + w - right, right],
  ] as const;
  const rows = [
    [0, top, y, top],
    [top, midH, y + top, h - top - bottom],
    [frame.height - bottom, bottom, y + h - bottom, bottom],
  ] as const;
  const quads: PixelQuad[] = [];
  for (const [sy, sh, dy, dh] of rows) {
    for (const [sx, sw, dx, dw] of columns) {
      if (dw <= 0 || dh <= 0) continue;
      if (!centre && sx === left && sy === top) continue;
      quads.push({
        dst: [dx * scale, dy * scale, dw * scale, dh * scale],
        src: [sx, sy, sw, sh],
        layer,
        scale,
        tint,
      });
    }
  }
  return quads;
}
