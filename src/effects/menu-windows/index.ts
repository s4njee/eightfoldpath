import bustUrl from '../../../assets/ui/traveller-bust.png?url';
import frameUrl from '../../../assets/ui/window-frame.png?url';
import { loadPixels, packTextureArray } from '../../gpu/assets.ts';
import { poseCamera } from '../../gpu/diorama/rig.ts';
import { createDioramaStage, loadSceneArt } from '../../gpu/diorama/stage.ts';
import { createFullscreenPipeline } from '../../gpu/fullscreen.ts';
import { hexToRgb8, rgb8ToLinear } from '../../gpu/palette/oklab.ts';
import { createBlur } from '../../gpu/passes/blur.ts';
import { linearSampler } from '../../gpu/passes/common.ts';
import { downsample } from '../../gpu/passes/downsample.ts';
import { createHdrTail } from '../../gpu/post/index.ts';
import { withChunks } from '../../gpu/shader.ts';
import { createRenderTarget, type RenderTarget } from '../../gpu/targets.ts';
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
import { createUniformBuffer, defineUniformStruct, uniformArray } from '../../gpu/uniforms.ts';
import { VILLAGE_ART, villageScene } from '../diorama/village.ts';
import { defaultInspect, defineEffect } from '../types.ts';
import { handPixels } from './cursor.ts';
import { buildMenu, COMMANDS, PARTY, type MenuDom } from './dom.ts';
import {
  BORDER,
  cursorNudge,
  cursorRect,
  glassCeiling,
  luminance,
  menuLayout,
  type MenuLayout,
  type Rect,
} from './layout.ts';
import shader from './menu.wgsl';
import { meta } from './meta.ts';
import { MENU_CSS, MENU_STYLE_ID } from './style.ts';

export { mountCssMenu, COMMANDS, type Command } from './dom.ts';
export { MENU_CSS } from './style.ts';

/*
 * Story 9.6: menu windows over a blurred, tinted copy of the scene behind them.
 *
 * The village diorama (src/gpu/diorama/stage.ts) is drawn once into a still, halved two or three
 * times (13-tap downsample) and blurred at that size, and redrawn only when the canvas changes
 * size. Each frame is then one fullscreen pass (menu.wgsl: the still outside the windows, the
 * tinted blur inside them), the frames' borders and the portrait as pixel quads, and the output
 * pass: Tier A however heavy the scene is. With `scene` set to `live` the diorama is drawn every
 * frame instead, without shadows or multisampling, and the cost is the stage's.
 *
 * The menu itself is HTML over the canvas (dom.ts): buttons, text and the hand. Without a DOM, as
 * in the headless tests and the poster, the canvas draws the labels in the bitmap font and the hand
 * from its pixel grid, so a still of the effect still shows a menu.
 */

const colour = (hex: string) => rgb8ToLinear(hexToRgb8(hex));
const INK = {
  text: colour('eee6c9'),
  active: colour('fad719'),
  disabled: colour('a9bbbf'),
  shadow: colour('131220'),
};
/** The glass must hold the dimmer of the two text colours at the contrast asked for. */
const TEXT_LUMINANCE = Math.min(luminance(INK.text), luminance(INK.active));
/** World units across the village that must stay in frame (as the diorama effect). */
const FRAME_WIDTH = 27;
const DIVISORS = { '1/2': 1, '1/4': 2, '1/8': 3 } as const;
const MAX_WINDOWS = 4;
const VIEWS = { final: 0, still: 1, blurred: 2 } as const;

const Params = defineUniformStruct('Params', {
  rects: uniformArray('vec4f', MAX_WINDOWS),
  tint: 'vec3f',
  tint_amount: 'f32',
  count: 'f32',
  ceiling: 'f32',
  scale: 'f32',
  shadow: 'f32',
  blur_on: 'f32',
  view: 'f32',
  exposure: 'f32',
});

export const effect = defineEffect({
  meta,
  params: {
    scene: { type: 'select', default: 'still', options: ['still', 'live'] },
    blur: {
      type: 'number',
      default: 5,
      min: 0,
      max: 16,
      step: 1,
      label: 'blur radius (reduced pixels)',
    },
    resolution: {
      type: 'select',
      default: '1/4',
      options: Object.keys(DIVISORS),
      label: 'blur resolution',
    },
    tint: { type: 'color', default: colour('212c62'), label: 'glass tint' },
    tintAmount: { type: 'number', default: 0.45, min: 0, max: 1, step: 0.01, label: 'tint' },
    contrast: {
      type: 'number',
      default: 4.5,
      min: 1,
      max: 10,
      step: 0.1,
      label: 'text contrast at least',
    },
    scale: {
      type: 'number',
      default: 0,
      min: 0,
      max: 8,
      step: 1,
      label: 'pixels per texel (0 = fit)',
    },
    sway: {
      type: 'number',
      default: 0.12,
      min: 0,
      max: 0.6,
      step: 0.01,
      label: 'live camera sway',
    },
  },
  presets: {
    'frosted glass': {},
    'thin glass': { blur: 2, tintAmount: 0.2 },
    'deep blur': { blur: 12, resolution: '1/8' },
    'live diorama': { scene: 'live' },
  },
  inspect: {
    views: ['still', 'blurred', 'quads'],
    stages: ['blur', 'tint', 'shadow', 'frames', 'portrait', 'cursor'],
  },

  async create({ device, format, hdr, canvas, params, profiler, inspect = defaultInspect() }) {
    const scene = villageScene();
    const tail = createHdrTail(device, { format, hdr, label: 'menu-windows' });
    const stage = createDioramaStage(device, {
      scene,
      art: await loadSceneArt(scene, VILLAGE_ART),
      colorFormat: 'rgba16float',
      label: 'menu backdrop',
    });
    const atlas = buildFontAtlas();
    const [frame, bust] = await Promise.all([loadPixels(frameUrl), loadPixels(bustUrl)]);
    const art = packTextureArray(device, [frame, bust, handPixels(), atlas.pixels], 'menu art');
    const [FRAME_LAYER, BUST, HAND, FONT] = art.layers.map((l) => l.layer) as [
      number,
      number,
      number,
      number,
    ];
    const quads = createPixelQuads(device, {
      format: tail.scene.format,
      art: art.view,
      label: 'menu windows',
    });

    const target = (label: string) =>
      createRenderTarget(device, { label, format: 'rgba16float', width: 1, height: 1 });
    const still = target('menu still');
    const reduced = [target('menu half'), target('menu quarter'), target('menu eighth')];
    const blur = createBlur(device, {
      label: 'menu glass',
      format: 'rgba16float',
      width: 1,
      height: 1,
    });
    const uniforms = createUniformBuffer(device, Params, 'menu glass');
    const composite = createFullscreenPipeline(device, {
      fragment: withChunks(shader, { 'params.wgsl': Params.wgsl }),
      format: tail.scene.format,
      label: 'menu glass',
    });
    let group: GPUBindGroup | undefined;
    let groupKey: readonly GPUTextureView[] = [];
    const bind = (glass: RenderTarget) => {
      if (groupKey[0] === still.view && groupKey[1] === glass.view && group) return group;
      groupKey = [still.view, glass.view];
      group = device.createBindGroup({
        label: 'menu glass',
        layout: composite.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniforms.buffer } },
          { binding: 1, resource: still.view },
          { binding: 2, resource: glass.view },
          { binding: 3, resource: linearSampler(device) },
        ],
      });
      return group;
    };

    // The HTML half; undefined without a DOM.
    let overlay: CanvasOverlay | undefined = createCanvasOverlay(canvas, {
      className: 'efp-menu efp-menu--canvas',
      styleId: MENU_STYLE_ID,
      css: MENU_CSS,
    });
    const menu: MenuDom | undefined = overlay
      ? buildMenu(overlay.root, { skin: 'canvas' })
      : undefined;
    const motion = watchMotion(canvas, (animate) =>
      overlay?.root.toggleAttribute('data-animate', animate),
    );
    overlay?.root.toggleAttribute('data-animate', motion.animate);

    let width = 1;
    let height = 1;
    let scale = 1;
    let layout: MenuLayout = menuLayout(1, 1, COMMANDS.length);
    let layoutKey = '';
    let stillKey = '';
    let clock = 0;

    function relayout() {
      const ratio = overlay?.pixelRatio() ?? 1;
      scale = params.scale >= 1 ? Math.round(params.scale) : fitTexelScale(width, ratio);
      const key = [width, height, scale, ratio].join();
      if (key === layoutKey) return;
      layoutKey = key;
      layout = menuLayout(Math.floor(width / scale), Math.floor(height / scale), COMMANDS.length);
      if (overlay && menu) {
        const texel = texelCss(scale, ratio);
        overlay.fit();
        overlay.root.style.setProperty('--efp-texel', `${texel}px`);
        menu.place(layout, texel);
      }
    }

    /** Draws the diorama into the still and makes its blurred copy. */
    function drawBackdrop(encoder: GPUCommandEncoder, live: boolean) {
      const camera = poseCamera(
        {
          ...scene.camera,
          yaw: scene.camera.yaw + (live ? params.sway * Math.sin(clock * 0.25) : 0),
          distance: Math.max(
            scene.camera.distance,
            FRAME_WIDTH / (2 * Math.tan((scene.camera.fov * Math.PI) / 360) * (width / height)),
          ),
        },
        width / height,
        'perspective',
      );
      stage.encode(encoder, {
        camera,
        time: clock,
        target: still.view,
        profiler,
        // A still is drawn once, so it can afford the sun's shadows and multisampling.
        settings: { shadows: !live, clear: [0.05, 0.06, 0.1] },
      });
      const levels = DIVISORS[params.resolution as keyof typeof DIVISORS] ?? 2;
      let source = still;
      for (let i = 0; i < levels; i++) {
        downsample(device, encoder, source.view, reduced[i]!);
        source = reduced[i]!;
      }
      blur.encode(encoder, source.view, source.view, { radius: params.blur });
    }

    const quad = (rect: Rect, src: Rect, layer: number, tint?: PixelQuad['tint']): PixelQuad => ({
      dst: [rect[0] * scale, rect[1] * scale, rect[2] * scale, rect[3] * scale],
      src,
      layer,
      scale,
      tint,
    });
    const text = (value: string, x: number, y: number, tint: PixelQuad['tint']) =>
      textQuads(layoutText(atlas, value), {
        x: x * scale,
        y: y * scale,
        scale,
        layer: FONT,
        tint,
        shadow: INK.shadow,
      });

    return {
      resize(w, h) {
        tail.resize(w, h);
        stage.resize(w, h);
        still.resize(w, h);
        reduced.forEach((level, i) =>
          level.resize(Math.ceil(w / 2 ** (i + 1)), Math.ceil(h / 2 ** (i + 1))),
        );
        width = w;
        height = h;
        relayout();
      },
      frame(time, encoder, target) {
        clock += time.delta;
        relayout();
        const live = params.scene === 'live';
        const levels = DIVISORS[params.resolution as keyof typeof DIVISORS] ?? 2;
        const glass = reduced[levels - 1]!;
        blur.resize(glass.width, glass.height);
        // The still waits for a change of size or of the blur; a live scene is drawn every frame.
        // A still is drawn multisampled, and the multisampled targets (about 100 MB at 1080p) are
        // let go on the frame after, once the frame that used them has been submitted.
        const key = [width, height, params.scene, params.resolution, params.blur].join();
        const redraw = live || key !== stillKey;
        const samples = redraw && !live ? 4 : 1;
        if (stage.sampleCount !== samples) stage.setSampleCount(samples);
        if (redraw) {
          stillKey = key;
          drawBackdrop(encoder, live);
        }

        const off = inspect.off;
        const view = VIEWS[inspect.view as keyof typeof VIEWS] ?? VIEWS.final;
        const windows = [layout.commands, layout.party, layout.message];
        const tinted = !off.has('tint');
        uniforms.set({
          rects: windows.flat(),
          tint: params.tint,
          tint_amount: tinted ? params.tintAmount : 0,
          count: windows.length,
          ceiling: tinted ? glassCeiling(TEXT_LUMINANCE, params.contrast) : 1,
          scale,
          shadow: off.has('shadow') ? 0 : 0.45,
          blur_on: off.has('blur') ? 0 : 1,
          view,
          exposure: 1,
        });
        uniforms.upload();
        const pass = encoder.beginRenderPass({
          label: 'menu glass',
          colorAttachments: [{ view: tail.scene.view, loadOp: 'clear', storeOp: 'store' }],
          timestampWrites: profiler.pass('glass'),
        });
        pass.setPipeline(composite);
        pass.setBindGroup(0, bind(glass));
        pass.draw(3);

        // The frames' borders, the portrait and, without a DOM, the text and the hand.
        const drawn: PixelQuad[] = [];
        if (view === VIEWS.final) {
          if (!off.has('frames')) {
            for (const rect of windows) {
              drawn.push(...nineSliceQuads(BORDER, FRAME_LAYER, rect, scale, undefined, false));
            }
          }
          if (layout.portrait && !off.has('portrait')) {
            drawn.push(quad(layout.portrait, [0, 0, bust.width, bust.height], BUST));
          }
          if (!menu) {
            COMMANDS.forEach((command, i) => {
              const [x, y] = layout.items[i]!;
              const ink = i === 0 ? INK.active : command.disabled ? INK.disabled : INK.text;
              drawn.push(...text(command.label, x, y + 2, ink));
            });
            const [sx, sy] = layout.stats;
            [PARTY.name, ...PARTY.lines].forEach((line, i) =>
              drawn.push(...text(line, sx, sy + 2 + i * 13, i === 0 ? INK.active : INK.text)),
            );
            drawn.push(...text('Where to next?', layout.line[0], layout.line[1] + 2, INK.text));
            if (!off.has('cursor')) {
              const hand = cursorRect(layout, 0, cursorNudge(clock, motion.animate));
              drawn.push(quad(hand, [0, 0, hand[2], hand[3]], HAND));
            }
          }
        }
        overlay?.root.toggleAttribute('data-no-cursor', off.has('cursor'));
        quads.set(drawn);
        quads.draw(pass, { width, height, debug: inspect.view === 'quads' });
        pass.end();

        // The glass is already tonemapped (it had to be, to hold the contrast ceiling), and the
        // frames keep their exact colours: the output pass only encodes.
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
        motion.stop();
        menu?.destroy();
        overlay?.destroy();
        overlay = undefined;
        quads.destroy();
        art.texture.destroy();
        uniforms.destroy();
        blur.destroy();
        still.destroy();
        reduced.forEach((level) => level.destroy());
        stage.destroy();
        tail.destroy();
      },
    };
  },
});
