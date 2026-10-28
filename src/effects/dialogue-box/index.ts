import hillsUrl from '../../../assets/parallax/hills.png?url';
import mountainsUrl from '../../../assets/parallax/mountains.png?url';
import skyUrl from '../../../assets/parallax/sky.png?url';
import treelineUrl from '../../../assets/parallax/treeline.png?url';
import bustUrl from '../../../assets/ui/traveller-bust.png?url';
import frameUrl from '../../../assets/ui/window-frame.png?url';
import { loadPixels, packTextureArray } from '../../gpu/assets.ts';
import { createFullscreenPipeline } from '../../gpu/fullscreen.ts';
import { hexToRgb8, rgb8ToLinear } from '../../gpu/palette/oklab.ts';
import { createHdrTail } from '../../gpu/post/index.ts';
import { withChunks } from '../../gpu/shader.ts';
import {
  buildFontAtlas,
  createPixelQuads,
  layoutText,
  nineSliceQuads,
  textQuads,
  type PixelQuad,
} from '../../gpu/text/index.ts';
import {
  createCanvasOverlay,
  fitTexelScale,
  texelCss,
  watchMotion,
  type CanvasOverlay,
} from '../../gpu/ui/overlay.ts';
import { createUniformBuffer, defineUniformStruct } from '../../gpu/uniforms.ts';
import { defaultInspect, defineEffect } from '../types.ts';
import shader from './dialogue.wgsl';
import { buildDialogue, type DialogueDom } from './dom.ts';
import {
  dialogueLayout,
  FRAME,
  textColumnWidth,
  type DialogueLayout,
  type Rect,
} from './layout.ts';
import { meta } from './meta.ts';
import { createDialogueState, markerBounce, type DialogueSettings } from './reveal.ts';
import { DIALOGUE_CSS, DIALOGUE_STYLE_ID } from './style.ts';

export { mountCssDialogue, type CssDialogueOptions } from './dom.ts';
export { DIALOGUE_CSS } from './style.ts';

/*
 * Story 9.5: a dialogue box that is a real interface component. The canvas draws what has to be
 * pixel art (the backdrop, the light round the window, the nine-slice frame, the portrait and the
 * bouncing marker), all at one whole-number texel scale so every texel is the same size; the DOM
 * over it holds what has to be HTML (the speaker's name, the line, the button). One texel layout
 * (layout.ts) places both. See dom.ts for the reveal and the accessibility.
 */

const colour = (hex: string) => rgb8ToLinear(hexToRgb8(hex));
const INK = {
  body: colour('42261e'),
  bodyShadow: colour('bf9d6c'),
  sky: colour('212c62'),
  shadow: colour('131220'),
  marker: colour('750c17'),
  lantern: colour('feb47a'),
};

const SCRIPTS = {
  story: {
    speaker: 'Traveller',
    pages: [
      'Eight roads leave this square, and only one of them reaches the coast before nightfall.',
      'Mind the slimes by the old well. They are slow, but they never give up a chase…',
      'Take the lantern — the forest path is darker than it looks from here!',
    ],
  },
  welcome: {
    speaker: 'Guide',
    pages: [
      'Welcome back! Your workspace is just as you left it.',
      'Three projects changed while you were away. Shall we look at them first?',
      'You can turn this guide off at any time in Settings, under Help.',
    ],
  },
} as const;

/** Texels from one line of bitmap text to the next, for the canvas's own copy of the text. */
const LINE_HEIGHT = 11;

const Params = defineUniformStruct('Params', {
  box: 'vec4f',
  glow_colour: 'vec3f',
  scale: 'f32',
  scrim: 'f32',
  reach: 'f32',
  glow: 'f32',
  halo_radius: 'f32',
  time: 'f32',
});

export const effect = defineEffect({
  meta,
  params: {
    text: { type: 'select', default: 'story', options: ['story', 'welcome'] },
    scale: {
      type: 'number',
      default: 0,
      min: 0,
      max: 8,
      step: 1,
      label: 'pixels per texel (0 = fit)',
    },
    typewriter: { type: 'boolean', default: true },
    speed: {
      type: 'number',
      default: 30,
      min: 1,
      max: 80,
      step: 1,
      label: 'characters per second',
    },
    hold: {
      type: 'number',
      default: 0,
      min: 0,
      max: 10,
      step: 0.5,
      label: 'turn the page after (s, 0 = wait)',
    },
    backdrop: { type: 'select', default: 'hills', options: ['hills', 'page'] },
    scrim: { type: 'number', default: 0.45, min: 0, max: 1, step: 0.01 },
    glow: { type: 'number', default: 0.3, min: 0, max: 1, step: 0.01, label: 'window glow' },
  },
  presets: {
    'reader paced': {},
    'slow storyteller': { speed: 12 },
    'welcome tour': { text: 'welcome', hold: 3.5 },
    'over the page': { backdrop: 'page', glow: 0, scrim: 0.3 },
  },
  inspect: {
    views: ['quads', 'slots'],
    stages: ['backdrop', 'scrim', 'glow', 'shadow', 'frame', 'portrait', 'typewriter'],
  },

  async create({ device, format, hdr, canvas, params, profiler, inspect = defaultInspect() }) {
    const tail = createHdrTail(device, { format, hdr, label: 'dialogue-box' });
    const atlas = buildFontAtlas();
    const urls = [frameUrl, bustUrl, skyUrl, mountainsUrl, hillsUrl, treelineUrl];
    const images = await Promise.all(urls.map((url) => loadPixels(url)));
    const art = packTextureArray(device, [atlas.pixels, ...images], 'dialogue-box art');
    const [FONT, FRAME_LAYER, BUST, ...BACKDROP] = art.layers.map((l) => l.layer) as number[];
    const layers = images.slice(2).map((image, i) => ({ image, layer: BACKDROP[i]! }));
    const marker = atlas.glyphs.get('▼')!;

    const back = createPixelQuads(device, {
      format: tail.scene.format,
      art: art.view,
      label: 'dialogue backdrop',
    });
    const front = createPixelQuads(device, {
      format: tail.scene.format,
      art: art.view,
      label: 'dialogue window',
    });
    const uniforms = createUniformBuffer(device, Params, 'dialogue light');
    const light = createFullscreenPipeline(device, {
      fragment: withChunks(shader, { 'params.wgsl': Params.wgsl }),
      format: tail.scene.format,
      // Premultiplied: the light adds its colour and hides `alpha` of what is behind it.
      blend: {
        color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
      },
      label: 'dialogue light',
    });
    const lightGroup = device.createBindGroup({
      label: 'dialogue light',
      layout: light.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniforms.buffer } }],
    });

    // The HTML half. Without a DOM (the headless tests) the canvas still draws the whole window.
    let overlay: CanvasOverlay | undefined;
    let dom: DialogueDom | undefined;
    let script: (typeof SCRIPTS)[keyof typeof SCRIPTS] = SCRIPTS.story;
    let state = createDialogueState(script.pages);
    const motion = watchMotion(canvas, () => sync());
    const settings = (): DialogueSettings => ({
      speed: params.speed,
      hold: params.hold,
      animate:
        motion.animate &&
        params.typewriter &&
        !inspect.off.has('typewriter') &&
        (dom?.canReveal ?? true),
    });
    /** Brings the DOM up to date with the state; safe to call with the frame loop stopped. */
    const sync = () => {
      if (!dom) return;
      const now = settings();
      dom.showPage(state.page);
      dom.reveal(state.revealed(now), state.complete(now), state.page === script.pages.length - 1);
    };

    let width = 1;
    let height = 1;
    let scale = 1;
    let layout: DialogueLayout = dialogueLayout(1, 1, 0);
    let layoutKey = '';
    let observer: ResizeObserver | undefined;

    function buildDom() {
      dom?.destroy();
      overlay?.destroy();
      observer?.disconnect();
      overlay = createCanvasOverlay(canvas, {
        className: 'efp-dialogue efp-dialogue--canvas',
        styleId: DIALOGUE_STYLE_ID,
        css: DIALOGUE_CSS,
      });
      dom = overlay
        ? buildDialogue(overlay.root, {
            speaker: script.speaker,
            pages: script.pages,
            skin: 'canvas',
            onAdvance() {
              state.advance(settings());
              sync();
            },
          })
        : undefined;
      // Wrapping can change after load (a web font, a zoom); measure again when it does.
      const View = canvas.ownerDocument?.defaultView?.ResizeObserver;
      if (dom && View) {
        observer = new View(() => {
          layoutKey = '';
          relayout();
        });
        observer.observe(dom.line);
      }
      layoutKey = '';
      sync();
    }

    /** Fits the texel scale, measures the text and places the DOM; the canvas follows each frame. */
    function relayout() {
      const ratio = overlay?.pixelRatio() ?? 1;
      scale = params.scale >= 1 ? Math.round(params.scale) : fitTexelScale(width, ratio);
      const key = [width, height, scale, ratio, params.text].join();
      if (key === layoutKey) return;
      layoutKey = key;
      const columns = Math.floor(width / scale);
      const rows = Math.floor(height / scale);
      const texel = texelCss(scale, ratio);
      const column = textColumnWidth(columns);
      let textHeight: number;
      if (dom && overlay) {
        overlay.fit();
        overlay.root.style.setProperty('--efp-texel', `${texel}px`);
        textHeight = Math.ceil(dom.measureText(column * texel) / texel);
      } else {
        // No DOM: the canvas draws the text itself in the bitmap font, so measure that instead.
        textHeight = Math.max(...script.pages.map((page) => bitmapText(page, column).height + 2));
      }
      layout = dialogueLayout(columns, rows, textHeight);
      dom?.place(layout, texel);
    }

    const bitmapText = (text: string, maxWidth: number) =>
      layoutText(atlas, text, { maxWidth, lineHeight: LINE_HEIGHT });

    const quad = (rect: Rect, src: Rect, layer: number, tint?: PixelQuad['tint']): PixelQuad => ({
      dst: [rect[0] * scale, rect[1] * scale, rect[2] * scale, rect[3] * scale],
      src,
      layer,
      scale,
      tint,
    });

    let clock = 0;
    buildDom();

    return {
      resize(w, h) {
        tail.resize(w, h);
        width = w;
        height = h;
        relayout();
      },
      frame(time, encoder, target) {
        const next = SCRIPTS[params.text as keyof typeof SCRIPTS] ?? SCRIPTS.story;
        if (next !== script) {
          script = next;
          state = createDialogueState(script.pages);
          buildDom();
        }
        relayout();
        const now = settings();
        state.tick(time.delta, now);
        sync();
        clock += time.delta;

        const off = inspect.off;
        const page = params.backdrop === 'page';
        const columns = Math.floor(width / scale);

        // The backdrop: four parallax layers along the top of the window, drifting a whole texel at
        // a time, each layer faster than the one behind it.
        const backdrop: PixelQuad[] = [];
        if (!page && !off.has('backdrop')) {
          // The treeline's top shows above the window; the layers behind it step up from there.
          const treesY = layout.window[1] - 40;
          const hillsY = treesY - 34;
          const mountainsY = hillsY - 30;
          const placed = [mountainsY - 6, mountainsY, hillsY, treesY];
          layers.forEach(({ image, layer }, i) => {
            const drift = Math.floor(clock * [0.5, 1, 2, 4][i]!) % image.width;
            backdrop.push({
              dst: [
                -drift * scale,
                placed[i]! * scale,
                (columns + drift + 1) * scale,
                image.height * scale,
              ],
              src: [0, 0, image.width, image.height],
              layer,
              scale,
            });
          });
        }

        // The window: a shadow, the nine-slice frame, the portrait and, once the line is out, the
        // marker bouncing a texel at a time.
        const win: PixelQuad[] = [];
        const [wx, wy, ww, wh] = layout.window;
        if (!off.has('shadow')) {
          win.push(
            ...nineSliceQuads(FRAME, FRAME_LAYER!, [wx + 2, wy + 2, ww, wh], scale, INK.shadow),
          );
        }
        if (!off.has('frame')) {
          win.push(...nineSliceQuads(FRAME, FRAME_LAYER!, layout.window, scale));
        }
        if (layout.portrait && !off.has('portrait')) {
          win.push(quad(layout.portrait, [0, 0, images[1]!.width, images[1]!.height], BUST!));
        }
        // Without a DOM (the headless tests, the poster) the canvas draws the text itself, in the
        // bitmap font, revealed on the same clock: a still then still reads as a dialogue box.
        if (!dom) {
          const [sx, sy] = layout.speaker;
          const [tx, ty, tw] = layout.text;
          const textAt = (
            value: string,
            x: number,
            y: number,
            tint: PixelQuad['tint'],
            typed: boolean,
          ) =>
            textQuads(bitmapText(value, tw), {
              x: x * scale,
              y: y * scale,
              scale,
              layer: FONT!,
              tint,
              shadow: INK.bodyShadow,
              orderOffset: typed ? 0 : undefined,
            });
          win.push(
            ...textAt(script.speaker, sx, sy, INK.marker, false),
            ...textAt(script.pages[state.page]!, tx, ty + 1, INK.body, true),
          );
        }
        if (state.complete(now)) {
          const [mx, my] = layout.marker;
          const lift = markerBounce(clock, now.animate);
          win.push(
            quad(
              [mx, my - lift, marker.width, 3],
              // The glyph's ink is its rows 2 to 4.
              [marker.x, marker.y + 2, marker.width, 3],
              FONT!,
              INK.marker,
            ),
          );
        }

        const slots = inspect.view === 'slots';
        const debug = inspect.view === 'quads' || slots;
        back.set(slots ? [] : backdrop);
        front.set(
          slots
            ? [layout.window, layout.portrait, layout.speaker, layout.text, layout.button]
                .filter((rect): rect is Rect => rect !== undefined)
                .map((rect) => quad(rect, [0, 0, 1, 1], FONT!))
            : win,
        );
        uniforms.set({
          box: layout.window,
          glow_colour: INK.lantern,
          scale,
          scrim: off.has('scrim') ? 0 : params.scrim,
          reach: 40,
          glow: off.has('glow') ? 0 : params.glow,
          halo_radius: 14,
          time: clock,
        });
        uniforms.upload();

        const clear = page ? [0, 0, 0, 0] : [INK.sky[0], INK.sky[1], INK.sky[2], 1];
        const pass = encoder.beginRenderPass({
          label: 'dialogue-box',
          colorAttachments: [
            { view: tail.scene.view, loadOp: 'clear', storeOp: 'store', clearValue: clear },
          ],
          timestampWrites: profiler.pass('dialogue'),
        });
        back.draw(pass, { width, height, debug });
        if (!debug) {
          pass.setPipeline(light);
          pass.setBindGroup(0, lightGroup);
          pass.draw(3);
        }
        front.draw(pass, { width, height, debug, reveal: now.animate ? state.clock : Infinity });
        pass.end();

        // No bloom, tonemap or dither: the art keeps its exact colours. Over the page the canvas
        // is see-through wherever nothing was drawn.
        tail.encode(
          encoder,
          target,
          time,
          {
            exposure: 1,
            bloom: 0,
            bloomThreshold: 1,
            bloomRadius: 0.5,
            alpha: page ? 'coverage' : undefined,
          },
          profiler,
          { bloom: false, output: { tonemap: 'none', dither: 0, exposure: 1 } },
        );
      },
      destroy() {
        observer?.disconnect();
        motion.stop();
        dom?.destroy();
        overlay?.destroy();
        back.destroy();
        front.destroy();
        uniforms.destroy();
        art.texture.destroy();
        tail.destroy();
      },
    };
  },
});
