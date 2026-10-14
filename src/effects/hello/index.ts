import { mat4, vec3 } from 'wgpu-matrix';
import cobblestone from '../../../assets/tiles/cobblestone.png?url';
import traveller from '../../../assets/sprites/traveller.png?url';
import { createPixelSampler, loadPixels, packTextureArray } from '../../gpu/assets.ts';
import { createHdrTail, TAIL_PARAMS } from '../../gpu/post/index.ts';
import { createShader, withChunks } from '../../gpu/shader.ts';
import { createUniformBuffer, defineUniformStruct } from '../../gpu/uniforms.ts';
import { defineEffect } from '../types.ts';
import shader from './hello.wgsl';
import { meta } from './meta.ts';

const Params = defineUniformStruct('Params', {
  view_proj: 'mat4x4f',
  camera_pos: 'vec3f',
  camera_right: 'vec3f',
  camera_up: 'vec3f',
  light_pos: 'vec3f',
  light_color: 'vec3f',
  light_intensity: 'f32',
  ambient: 'vec3f',
  sprite_feet: 'vec3f',
  shadow: 'f32',
  glow: 'f32',
});

/** World units per texel. One tile is 16 texels (plan.md, "Pixel scale"). */
const TEXEL = 1 / 16;
/** How much of the cobblestone texture the ground shows: 64 texels, four world units. */
const GROUND_TEXELS = 64;
const KIND = { ground: 0, sprite: 1, glow: 2 } as const;
const QUAD_FLOATS = 12;

export const effect = defineEffect({
  meta,
  params: {
    lightSpeed: { type: 'number', default: 0.4, min: -2, max: 2, step: 0.01, label: 'light speed' },
    lightHeight: {
      type: 'number',
      default: 1.6,
      min: 0.3,
      max: 5,
      step: 0.01,
      label: 'light height',
    },
    lightRadius: {
      type: 'number',
      default: 2.4,
      min: 0.5,
      max: 5,
      step: 0.01,
      label: 'light radius',
    },
    lightIntensity: {
      type: 'number',
      default: 9,
      min: 0,
      max: 40,
      step: 0.1,
      label: 'light intensity',
    },
    lightColor: { type: 'color', default: [1, 0.55, 0.22], label: 'light colour' },
    ambient: { type: 'color', default: [0.05, 0.06, 0.11] },
    glow: { type: 'number', default: 6, min: 0, max: 30, step: 0.1 },
    shadow: { type: 'number', default: 0.35, min: 0, max: 1, step: 0.01, label: 'contact shadow' },
    cameraYaw: {
      type: 'number',
      default: 0.35,
      min: -3.14,
      max: 3.14,
      step: 0.01,
      label: 'camera yaw',
    },
    cameraPitch: {
      type: 'number',
      default: 35,
      min: 5,
      max: 85,
      step: 0.5,
      label: 'camera pitch (degrees)',
    },
    fov: { type: 'number', default: 25, min: 10, max: 60, step: 0.5, label: 'field of view' },
    ...TAIL_PARAMS,
  },
  presets: {
    lantern: {
      lightSpeed: 0.25,
      lightIntensity: 9,
      lightColor: [1, 0.55, 0.22],
      ambient: [0.05, 0.06, 0.11],
    },
    moonlight: {
      lightSpeed: 0.1,
      lightHeight: 4,
      lightIntensity: 14,
      lightColor: [0.55, 0.7, 1],
      ambient: [0.02, 0.03, 0.06],
      glow: 2,
    },
    'top down': { cameraPitch: 70, fov: 30 },
  },

  async create({ device, format, hdr, params, profiler }) {
    const tail = createHdrTail(device, { format, hdr, label: 'hello' });
    const [ground, sprite] = await Promise.all([loadPixels(cobblestone), loadPixels(traveller)]);
    const art = packTextureArray(device, [ground, sprite], 'hello art');
    const [groundLayer, spriteLayer] = art.layers;
    const sampler = createPixelSampler(device);
    const uniforms = createUniformBuffer(device, Params, 'hello params');

    // Ground, sprite, glow. Only the glow moves, so the buffer is rewritten each frame anyway.
    const quadData = new Float32Array(QUAD_FLOATS * 3);
    const groundSize = GROUND_TEXELS * TEXEL;
    quadData.set(
      [
        ...[0, 0, 0, KIND.ground],
        ...[groundSize, groundSize, groundLayer!.layer, 0],
        ...[
          (GROUND_TEXELS / ground.width) * groundLayer!.uvScale[0],
          (GROUND_TEXELS / ground.height) * groundLayer!.uvScale[1],
          0,
          0,
        ],
        ...[0, 0, 0, KIND.sprite],
        ...[sprite.width * TEXEL, sprite.height * TEXEL, spriteLayer!.layer, 0],
        ...[spriteLayer!.uvScale[0], spriteLayer!.uvScale[1], 0, 0],
      ],
      0,
    );
    const quads = device.createBuffer({
      label: 'hello quads',
      size: quadData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    const layout = device.createBindGroupLayout({
      label: 'hello',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: '2d-array' } },
        { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });
    const bindGroup = device.createBindGroup({
      label: 'hello',
      layout,
      entries: [
        { binding: 0, resource: { buffer: uniforms.buffer } },
        { binding: 1, resource: sampler },
        { binding: 2, resource: art.view },
        { binding: 3, resource: { buffer: quads } },
      ],
    });
    const module = createShader(device, withChunks(shader, { 'params.wgsl': Params.wgsl }));
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const depthFormat: GPUTextureFormat = 'depth24plus';
    const lit = device.createRenderPipeline({
      label: 'hello lit',
      layout: pipelineLayout,
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs_lit', targets: [{ format: tail.scene.format }] },
      depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'less' },
    });
    const glow = device.createRenderPipeline({
      label: 'hello glow',
      layout: pipelineLayout,
      vertex: { module, entryPoint: 'vs' },
      fragment: {
        module,
        entryPoint: 'fs_glow',
        targets: [
          {
            format: tail.scene.format,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one' },
              alpha: { srcFactor: 'zero', dstFactor: 'one' },
            },
          },
        ],
      },
      depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'less' },
    });

    let depth: GPUTexture | undefined;
    let aspect = 1;
    let phase = 0;

    return {
      resize(width, height) {
        tail.resize(width, height);
        depth?.destroy();
        depth = device.createTexture({
          label: 'hello depth',
          size: [width, height],
          format: depthFormat,
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        aspect = width / height;
      },
      frame(time, encoder, target) {
        if (!depth) return;
        phase += time.delta * params.lightSpeed;

        // The camera looks at the middle of the sprite from a fixed pitch, far enough back that
        // the narrow field of view frames the tile: the diorama read of plan.md's camera decision.
        const pitch = (params.cameraPitch * Math.PI) / 180;
        const focus = vec3.fromValues(0, sprite.height * TEXEL * 0.3, 0);
        const distance = 4.4 / Math.tan((params.fov * Math.PI) / 360);
        const eye = vec3.add(focus, [
          Math.sin(params.cameraYaw) * Math.cos(pitch) * distance,
          Math.sin(pitch) * distance,
          Math.cos(params.cameraYaw) * Math.cos(pitch) * distance,
        ]);
        const view = mat4.lookAt(eye, focus, [0, 1, 0]);
        const projection = mat4.perspective((params.fov * Math.PI) / 180, aspect, 0.1, 100);
        const right = vec3.normalize([view[0]!, 0, view[8]!]);
        const up = vec3.fromValues(view[1]!, view[5]!, view[9]!);

        const light = [
          Math.cos(phase) * params.lightRadius,
          params.lightHeight,
          Math.sin(phase) * params.lightRadius,
        ] as const;
        quadData.set([...light, KIND.glow, 0.6, 0.6, 0, 0, 1, 1, 0, 0], QUAD_FLOATS * 2);
        device.queue.writeBuffer(quads, 0, quadData);

        uniforms.set({
          view_proj: mat4.multiply(projection, view),
          camera_pos: [eye[0]!, eye[1]!, eye[2]!],
          camera_right: [right[0]!, right[1]!, right[2]!],
          camera_up: [up[0]!, up[1]!, up[2]!],
          light_pos: light,
          light_color: params.lightColor,
          light_intensity: params.lightIntensity,
          ambient: params.ambient,
          sprite_feet: [0, 0, 0],
          shadow: params.shadow,
          glow: params.glow,
        });
        uniforms.upload();

        const pass = encoder.beginRenderPass({
          label: 'hello scene',
          colorAttachments: [
            {
              view: tail.scene.view,
              loadOp: 'clear',
              storeOp: 'store',
              // A dark dusk sky behind the diorama, in linear light.
              clearValue: [0.008, 0.01, 0.025, 1],
            },
          ],
          depthStencilAttachment: {
            view: depth.createView(),
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
            depthClearValue: 1,
          },
          timestampWrites: profiler.pass('scene'),
        });
        pass.setBindGroup(0, bindGroup);
        pass.setPipeline(lit);
        pass.draw(6, 2, 0, 0);
        pass.setPipeline(glow);
        pass.draw(6, 1, 0, 2);
        pass.end();

        tail.encode(encoder, target, time, params, profiler);
      },
      destroy() {
        depth?.destroy();
        quads.destroy();
        art.texture.destroy();
        uniforms.destroy();
        tail.destroy();
      },
    };
  },
});
