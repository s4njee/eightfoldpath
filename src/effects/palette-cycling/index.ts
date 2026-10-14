import lavaUrl from '../../../assets/cycling/lava.png?url';
import waterfallUrl from '../../../assets/cycling/waterfall.png?url';
import { loadPixels } from '../../gpu/assets.ts';
import {
  hexToRgb8,
  indexImage,
  rgb8ToLinear,
  type IndexedImage,
  type Rgb8,
} from '../../gpu/palette/index.ts';
import { createHdrTail } from '../../gpu/post/index.ts';
import { createShader, withChunks } from '../../gpu/shader.ts';
import { createUniformBuffer, defineUniformStruct, uniformArray } from '../../gpu/uniforms.ts';
import { defaultInspect, defineEffect } from '../types.ts';
import { meta } from './meta.ts';
import shader from './palette-cycling.wgsl';

const Params = defineUniformStruct('Params', {
  images: uniformArray('vec4f', 8),
  background: 'vec3f',
  view: 'f32',
  marker: 'vec3f',
  blend: 'f32',
});

/**
 * The colours that cycle in each image, dark to light. They are already palette colours, banded
 * by the artist; everything else in the image (rock, foam, crust) stays still.
 *
 * The waterfall's foam is a9bbbf, the same colour as the lit rock around it, so it cannot cycle
 * without the rock cycling too: an indexed image needs separate entries for colours that look the
 * same but move differently, and this art was not drawn that way.
 */
const RAMPS: Readonly<Record<'waterfall' | 'lava', readonly Rgb8[]>> = {
  waterfall: ['212c62', '234d86', '2b70b7', '1ea3f9'].map(hexToRgb8),
  lava: ['4d0417', '750c17', 'a20e15', 'da3a37', 'f67908', 'fad719'].map(hexToRgb8),
};

/**
 * WCAG 2.3.1 allows three flashes a second. One texel passes through its range once per cycle,
 * but the analyser (tests/flash.ts) averages cells of many texels in different bands, and a
 * cell's average brightness moves at every step: two steps make one flash. So the cap is on steps,
 * not cycles: five steps a second is 2.5 flashes, a margin under three. Measured: 6 steps a second
 * peaks at exactly 3 per cell, 15 at 7 over most of the frame.
 */
export const MAX_STEPS_PER_SECOND = 5;

/**
 * Steps of lag per texel row in the waterfall's "by row" flow: each colour band is two rows tall
 * and moves down two rows per step. A quarter (four-row bands) read as sliding blocks rather than
 * streaks on this art.
 */
const ROW_LAG = 0.5;

const RANGES = ['whole ramp', 'bright end', 'dark end'] as const;
const VIEWS: Readonly<Record<string, number>> = { indices: 1, ranges: 2 };

/** Which part of a ramp of `n` colours cycles. */
function rangeOf(choice: string, n: number): { start: number; length: number } {
  const part = Math.min(n, 3);
  if (choice === 'bright end') return { start: n - part, length: part };
  if (choice === 'dark end') return { start: 0, length: part };
  return { start: 0, length: n };
}

export const effect = defineEffect({
  meta,
  params: {
    speed: {
      type: 'number',
      default: 4,
      min: 0,
      max: 15,
      step: 0.5,
      label: 'colour steps per second',
    },
    direction: { type: 'select', default: 'forward', options: ['forward', 'backward'] },
    range: { type: 'select', default: 'whole ramp', options: RANGES },
    waterfallFlow: {
      type: 'select',
      default: 'by row',
      options: ['by row', 'as drawn'],
      label: 'waterfall flow',
    },
    blend: { type: 'boolean', default: false, label: 'blend between steps' },
    flashCap: {
      type: 'boolean',
      default: true,
      label: `cap at ${MAX_STEPS_PER_SECOND} steps a second (flash safety)`,
    },
  },
  presets: {
    'slow and smooth': { speed: 2, blend: true },
    'as drawn': { waterfallFlow: 'as drawn' },
    'bright end only': { range: 'bright end', speed: 3 },
    'uncapped (flashes)': { speed: 15, flashCap: false },
  },
  inspect: { views: ['indices', 'ranges'], stages: ['waterfall', 'lava'] },

  async create({ device, format, hdr, params, profiler, inspect = defaultInspect() }) {
    const tail = createHdrTail(device, { format, hdr, label: 'palette-cycling' });
    const [waterfallPixels, lavaPixels] = await Promise.all([
      loadPixels(waterfallUrl),
      loadPixels(lavaUrl),
    ]);
    const images: IndexedImage[] = [
      indexImage(waterfallPixels, { leading: RAMPS.waterfall, maxColours: 32 }),
      indexImage(lavaPixels, { leading: RAMPS.lava, maxColours: 32 }),
    ];
    const rampLengths = [RAMPS.waterfall.length, RAMPS.lava.length];

    // Indices: one r8uint layer per image, padded to the larger size.
    const width = Math.max(...images.map((image) => image.width));
    const height = Math.max(...images.map((image) => image.height));
    const indexTexture = device.createTexture({
      label: 'palette-cycling indices',
      size: [width, height, images.length],
      format: 'r8uint',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    images.forEach((image, layer) =>
      device.queue.writeTexture(
        { texture: indexTexture, origin: [0, 0, layer] },
        image.indices as Uint8Array<ArrayBuffer>,
        { bytesPerRow: image.width },
        [image.width, image.height, 1],
      ),
    );
    // Palettes: one row per image.
    const paletteWidth = Math.max(...images.map((image) => image.palette.length));
    const paletteData = new Uint8Array(paletteWidth * images.length * 4);
    images.forEach((image, row) =>
      image.palette.forEach((colour, i) =>
        paletteData.set([...colour, 255], (row * paletteWidth + i) * 4),
      ),
    );
    const paletteTexture = device.createTexture({
      label: 'palette-cycling palettes',
      size: [paletteWidth, images.length],
      format: 'rgba8unorm-srgb',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture: paletteTexture },
      paletteData,
      { bytesPerRow: paletteWidth * 4 },
      [paletteWidth, images.length],
    );

    const uniforms = createUniformBuffer(device, Params, 'palette-cycling params');
    const module = createShader(device, withChunks(shader, { 'params.wgsl': Params.wgsl }));
    const layout = device.createBindGroupLayout({
      label: 'palette-cycling',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'uint', viewDimension: '2d-array' },
        },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      ],
    });
    const bindGroup = device.createBindGroup({
      label: 'palette-cycling',
      layout,
      entries: [
        { binding: 0, resource: { buffer: uniforms.buffer } },
        { binding: 1, resource: indexTexture.createView({ dimension: '2d-array' }) },
        { binding: 2, resource: paletteTexture.createView() },
      ],
    });
    const pipeline = device.createRenderPipeline({
      label: 'palette-cycling',
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'fullscreen_vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: tail.scene.format }] },
    });

    let canvasWidth = 1;
    let canvasHeight = 1;
    // Each image keeps its own phase, so changing the speed changes the rate from here on
    // instead of jumping to wherever the new rate would have got to by now.
    let phases: [number, number] | undefined;

    return {
      resize(w, h) {
        tail.resize(w, h);
        canvasWidth = w;
        canvasHeight = h;
      },
      frame(time, encoder, target) {
        const sign = params.direction === 'backward' ? -1 : 1;
        const ranges = rampLengths.map((n) => rangeOf(params.range, n));
        const speed = params.flashCap ? Math.min(params.speed, MAX_STEPS_PER_SECOND) : params.speed;
        const rates = ranges.map(() => sign * speed);
        // Start from the clock rather than zero, so a page opened later is not always at the
        // same frame of the cycle, and one step in, so the first frame already differs from the
        // art as drawn (which is what the inspector's stages switch back to).
        phases ??= [time.time * rates[0]! + 1, time.time * rates[1]! + 1];
        phases[0] += time.delta * rates[0]!;
        phases[1] += time.delta * rates[1]!;

        // Layout in units of one lava texel; the waterfall is half the size, so it is drawn at
        // twice the scale. Margins 8, gap 12, strips of 5-unit swatches 6 units below.
        // Whole-number scales keep every texel square; a canvas too small for even one pixel per
        // texel gets a fractional scale, which drops texels but still shows everything.
        const fit = Math.min(canvasWidth / 217, canvasHeight / 129);
        const unit = fit >= 1 ? Math.floor(fit) : fit;
        const ox = Math.floor((canvasWidth - 217 * unit) / 2);
        const oy = Math.floor((canvasHeight - 129 * unit) / 2);
        const [waterfall, lava] = images as [IndexedImage, IndexedImage];
        const placement = [
          {
            image: waterfall,
            origin: [ox + 8 * unit, oy + (8 + 6) * unit],
            scale: 2 * unit,
            centre: 8 + 45,
          },
          {
            image: lava,
            origin: [ox + 110 * unit, oy + 8 * unit],
            scale: unit,
            centre: 110 + 49.5,
          },
        ];
        const packed: number[] = [];
        placement.forEach(({ image, origin, scale, centre }, i) => {
          const stage = i === 0 ? 'waterfall' : 'lava';
          const cycling = !inspect.off.has(stage);
          const range = ranges[i]!;
          const stripWidth = image.palette.length * 5;
          packed.push(
            ...[origin[0]!, origin[1]!, scale, i],
            ...[image.width, image.height, i, image.palette.length],
            ...[
              range.start,
              range.length,
              cycling ? phases![i]! : 0,
              cycling && i === 0 && params.waterfallFlow === 'by row' ? ROW_LAG * sign : 0,
            ],
            ...[ox + Math.round(centre - stripWidth / 2) * unit, oy + 113 * unit, 5 * unit, 0],
          );
        });

        uniforms.set({
          images: packed,
          background: rgb8ToLinear(hexToRgb8('131220')),
          marker: rgb8ToLinear(hexToRgb8('eee6c9')),
          view: VIEWS[inspect.view] ?? 0,
          blend: params.blend ? 1 : 0,
        });
        uniforms.upload();

        const pass = encoder.beginRenderPass({
          label: 'palette-cycling',
          colorAttachments: [
            { view: tail.scene.view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
          ],
          timestampWrites: profiler.pass('cycle'),
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3);
        pass.end();

        // No bloom, tonemap or output dither, so the palette colours reach the canvas exactly.
        tail.encode(
          encoder,
          target,
          time,
          { exposure: 1, bloom: 0, bloomThreshold: 1, bloomRadius: 0.5 },
          profiler,
          { bloom: false, output: { tonemap: 'none', dither: 0, exposure: 1 } },
        );
      },
      destroy() {
        indexTexture.destroy();
        paletteTexture.destroy();
        uniforms.destroy();
        tail.destroy();
      },
    };
  },
});
