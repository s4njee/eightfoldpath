import hillsUrl from '../../../assets/parallax/hills.png?url';
import mountainsUrl from '../../../assets/parallax/mountains.png?url';
import skyUrl from '../../../assets/parallax/sky.png?url';
import treelineUrl from '../../../assets/parallax/treeline.png?url';
import bustUrl from '../../../assets/ui/traveller-bust.png?url';
import frameUrl from '../../../assets/ui/window-frame.png?url';
import { loadPixels, packTextureArray } from '../../gpu/assets.ts';
import { hexToRgb8, rgb8ToLinear } from '../../gpu/palette/oklab.ts';
import { createHdrTail } from '../../gpu/post/index.ts';
import {
  buildFontAtlas,
  createPixelQuads,
  layoutText,
  nineSliceQuads,
  textQuads,
  type NineSlice,
  type PixelQuad,
  type TextLayout,
} from '../../gpu/text/index.ts';
import { defaultInspect, defineEffect } from '../types.ts';
import { meta } from './meta.ts';

const colour = (hex: string) => rgb8ToLinear(hexToRgb8(hex));
const INK = {
  body: colour('42261e'),
  bodyShadow: colour('bf9d6c'),
  name: colour('750c17'),
  title: colour('eee6c9'),
  subtitle: colour('feb47a'),
  night: colour('131220'),
  sky: colour('212c62'),
  atlasPaper: colour('2b2d32'),
};

/** The parchment frame's corners and edges, read off assets/ui/window-frame.png. */
const FRAME: NineSlice = { insets: [7, 6, 7, 7], width: 74, height: 51 };

const PAGES = {
  story: [
    'Eight roads leave this square, and only one of them reaches the coast before nightfall.',
    'Mind the slimes by the old well. They are slow, but they never give up a chase…',
    'Take the lantern — the forest path is darker than it looks from here!',
  ],
  specimen: [
    'Sphinx of black quartz, judge my vow. 0123456789',
    'ABCDEFGHIJKLM NOPQRSTUVWXYZ abcdefghijklm nopqrstuvwxyz',
    '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
  ],
} as const;

/** Texels of the dialogue box. */
const BOX_HEIGHT = 66;
const BOX_MAX_WIDTH = 300;
const LINE_HEIGHT = 11;

export const effect = defineEffect({
  meta,
  params: {
    scale: {
      type: 'number',
      default: 0,
      min: 0,
      max: 8,
      step: 1,
      label: 'pixels per texel (0 = fit)',
    },
    text: { type: 'select', default: 'story', options: ['story', 'specimen'] },
    typewriter: { type: 'boolean', default: true },
    speed: {
      type: 'number',
      default: 24,
      min: 1,
      max: 80,
      step: 1,
      label: 'characters per second',
    },
    hold: { type: 'number', default: 2.5, min: 0.5, max: 10, step: 0.5, label: 'hold page (s)' },
  },
  presets: {
    'slow storyteller': { speed: 10, hold: 4 },
    'font specimen': { text: 'specimen', speed: 40, hold: 2 },
    'large type': { scale: 6 },
  },
  inspect: { views: ['atlas', 'quads'], stages: ['typewriter', 'shadow', 'frame'] },

  async create({ device, format, hdr, params, profiler, inspect = defaultInspect() }) {
    const tail = createHdrTail(device, { format, hdr, label: 'bitmap-text' });
    const atlas = buildFontAtlas();
    const images = await Promise.all(
      [frameUrl, bustUrl, skyUrl, mountainsUrl, hillsUrl, treelineUrl].map((url) =>
        loadPixels(url),
      ),
    );
    const art = packTextureArray(device, [atlas.pixels, ...images], 'bitmap-text art');
    const [FONT, FRAME_LAYER, BUST, SKY, MOUNTAINS, HILLS, TREES] = art.layers.map(
      (l) => l.layer,
    ) as [number, number, number, number, number, number, number];
    const bust = images[1]!;
    const quads = createPixelQuads(device, {
      format: tail.scene.format,
      art: art.view,
      label: 'bitmap-text',
    });

    let width = 1;
    let height = 1;
    let page = 0;
    let clock = 0;
    let bob = 0;
    // The laid-out page is kept until the page, the size or the text choice changes.
    let cached:
      | { key: string; body: TextLayout; lastGlyph: PixelQuad | undefined; quads: PixelQuad[] }
      | undefined;

    /** Everything on screen except the "more" marker, for the current page and size. */
    function build(scale: number, pages: readonly string[]): typeof cached {
      const cw = Math.floor(width / scale);
      const ch = Math.floor(height / scale);
      const out: PixelQuad[] = [];

      // Backdrop: four parallax layers repeated across, anchored to the bottom edge.
      const treesY = ch - 66;
      const hillsY = treesY - 34;
      const mountainsY = hillsY - 30;
      const skyY = mountainsY - 6;
      for (const [layer, y, image] of [
        [SKY, skyY, images[2]!],
        [MOUNTAINS, mountainsY, images[3]!],
        [HILLS, hillsY, images[4]!],
        [TREES, treesY, images[5]!],
      ] as const) {
        out.push({
          dst: [0, y * scale, cw * scale + scale, image.height * scale],
          src: [0, 0, image.width, image.height],
          layer,
          scale,
        });
      }

      // The dialogue box: a nine-slice frame, the speaker's portrait, a name and the page. The
      // page is laid out first so the box can grow to hold it when the scale leaves few columns.
      const shadow = !inspect.off.has('shadow');
      const boxW = Math.max(24, Math.min(cw - 12, BOX_MAX_WIDTH));
      const boxX = Math.floor((cw - boxW) / 2);
      const portrait = boxW >= 150;
      const textX = portrait ? boxX + 9 + bust.width + 7 : boxX + 10;
      const body = layoutText(atlas, pages[page % pages.length]!, {
        maxWidth: boxX + boxW - 10 - textX,
        lineHeight: LINE_HEIGHT,
      });
      const bodyTop = 8 + LINE_HEIGHT + 3;
      const boxH = Math.max(BOX_HEIGHT, bodyTop + body.height + 8);
      const boxY = ch - boxH - 6;
      if (!inspect.off.has('frame')) {
        out.push(...nineSliceQuads(FRAME, FRAME_LAYER, [boxX, boxY, boxW, boxH], scale));
      }
      if (portrait) {
        const py = boxY + Math.floor((boxH - bust.height) / 2);
        out.push({
          dst: [(boxX + 9) * scale, py * scale, bust.width * scale, bust.height * scale],
          src: [0, 0, bust.width, bust.height],
          layer: BUST,
          scale,
        });
      }
      const name = layoutText(atlas, params.text === 'specimen' ? 'Specimen' : 'Traveller');
      out.push(
        ...textQuads(name, {
          x: textX * scale,
          y: (boxY + 8) * scale,
          scale,
          layer: FONT,
          tint: INK.name,
          shadow: shadow ? INK.bodyShadow : undefined,
        }),
      );
      out.push(
        ...textQuads(body, {
          x: textX * scale,
          y: (boxY + bodyTop) * scale,
          scale,
          layer: FONT,
          tint: INK.body,
          shadow: shadow ? INK.bodyShadow : undefined,
          orderOffset: 0,
        }),
      );
      const lastGlyph = out.at(-1);

      // Title card: a small line over the dark top of the sky, then the title at twice the text
      // scale (or the text scale, when twice would not fit across). Each sits on its own scale's
      // grid, and the card is left out when the box has taken its room.
      const subtitle = layoutText(atlas, 'Chapter One \u2014 The Lantern Road');
      const title = layoutText(atlas, 'THE EIGHTFOLD PATH');
      const big = title.width * scale * 2 <= width - 4 * scale ? scale * 2 : scale;
      const subtitleY = Math.max(1, Math.floor(ch * 0.05)) * scale;
      const titleY = Math.ceil((subtitleY + (subtitle.height + 4) * scale) / big) * big;
      if (titleY + (title.height + 1) * big <= boxY * scale) {
        out.push(
          ...textQuads(subtitle, {
            x: Math.floor((cw - subtitle.width) / 2) * scale,
            y: subtitleY,
            scale,
            layer: FONT,
            tint: INK.subtitle,
            shadow: shadow ? INK.night : undefined,
          }),
          ...textQuads(title, {
            x: Math.floor((width / big - title.width) / 2) * big,
            y: titleY,
            scale: big,
            layer: FONT,
            tint: INK.title,
            shadow: shadow ? INK.night : undefined,
          }),
        );
      }
      return { key: '', body, lastGlyph, quads: out };
    }

    return {
      resize(w, h) {
        tail.resize(w, h);
        width = w;
        height = h;
      },
      frame(time, encoder, target) {
        const pages = PAGES[params.text as keyof typeof PAGES] ?? PAGES.story;
        const fit = Math.max(1, Math.min(8, Math.floor(Math.min(width / 240, height / 135))));
        const scale = params.scale >= 1 ? Math.round(params.scale) : fit;
        const typing = params.typewriter && !inspect.off.has('typewriter');

        const key = [
          width,
          height,
          scale,
          params.text,
          page,
          [...inspect.off].sort().join(),
        ].join();
        if (cached?.key !== key) cached = { ...build(scale, pages)!, key };

        // The reveal clock counts characters. After the page is out it holds, then turns.
        if (typing) {
          clock += time.delta * params.speed;
          if (clock > cached.body.duration + params.hold * params.speed) {
            clock = 0;
            page = (page + 1) % pages.length;
          }
        }
        bob += time.delta;
        const reveal = typing ? clock : Infinity;

        // The "more" marker: shown once the page is out, bobbing one texel rather than blinking.
        const all = [...cached.quads];
        if (reveal >= cached.body.duration) {
          const marker = atlas.glyphs.get('▼')!;
          const textQuad = cached.lastGlyph;
          if (textQuad) {
            const x = textQuad.dst[0] + textQuad.dst[2] + 3 * scale;
            const y = textQuad.dst[1] + (Math.floor(bob * 2) % 2) * scale;
            all.push({
              dst: [x, y, marker.width * scale, marker.height * scale],
              src: [marker.x, marker.y, marker.width, marker.height],
              layer: FONT,
              scale,
              tint: INK.name,
            });
          }
        }

        let clear: readonly [number, number, number] = INK.sky;
        if (inspect.view === 'atlas') {
          // The atlas alone, as large as fits, on a dark ground.
          const s = Math.max(
            1,
            Math.floor(
              Math.min(width / (atlas.pixels.width + 4), height / (atlas.pixels.height + 4)),
            ),
          );
          const x = Math.floor((width - atlas.pixels.width * s) / 2);
          const y = Math.floor((height - atlas.pixels.height * s) / 2);
          clear = INK.atlasPaper;
          quads.set([
            {
              dst: [x, y, atlas.pixels.width * s, atlas.pixels.height * s],
              src: [0, 0, atlas.pixels.width, atlas.pixels.height],
              layer: FONT,
              scale: s,
              tint: INK.title,
            },
          ]);
        } else {
          quads.set(all);
        }

        const pass = encoder.beginRenderPass({
          label: 'bitmap-text',
          colorAttachments: [
            {
              view: tail.scene.view,
              loadOp: 'clear',
              storeOp: 'store',
              clearValue: [clear[0], clear[1], clear[2], 1],
            },
          ],
          timestampWrites: profiler.pass('text'),
        });
        quads.draw(pass, { width, height, reveal, debug: inspect.view === 'quads' });
        pass.end();

        // No bloom, tonemap or output dither: the art and the ink keep their exact colours.
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
        quads.destroy();
        art.texture.destroy();
        tail.destroy();
      },
    };
  },
});
