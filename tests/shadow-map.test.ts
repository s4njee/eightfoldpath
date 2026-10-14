import { describe, expect, it } from 'vitest';
import { vec4 } from 'wgpu-matrix';
import {
  createShadowMap,
  planarProjection,
  SHADOW_PCF_WGSL,
} from '../src/gpu/lighting/shadow-map.ts';
import { expectValid, getTestDevice } from './gpu.ts';

describe('planarProjection', () => {
  it('flattens a point onto the ground along the light', () => {
    const m = planarProjection([1, -1, 0]);
    const top = vec4.transformMat4([0, 2, 0, 1], m);
    expect([...top]).toEqual([2, 0, 0, 1].map((v) => expect.closeTo(v, 6)));
    // Feet on the ground stay where they are, lifted to the requested height.
    const feet = vec4.transformMat4([3, 0, -1, 1], planarProjection([0.3, -1, 0.5], 0.02));
    expect([...feet]).toEqual([3, 0.02, -1, 1].map((v) => expect.closeTo(v, 6)));
  });

  it('keeps grazing light finite', () => {
    const m = planarProjection([1, 0, 0]);
    const p = vec4.transformMat4([0, 1, 0, 1], m);
    expect(Number.isFinite(p[0]!)).toBe(true);
  });
});

describe('shadow_pcf', () => {
  // Left half of a small map holds an occluder at depth 0.5; the right half is empty (cleared to 1).
  async function sample(points: readonly (readonly [number, number, number, number])[]) {
    const device = await getTestDevice();
    return expectValid(device, async () => {
      const shadow = createShadowMap(device, { size: 32, label: 'test shadow' });
      const occluder = device.createShaderModule({
        code: `@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
          let x = array<f32, 6>(-1.0, 0.0, 0.0, -1.0, 0.0, -1.0)[i];
          let y = array<f32, 6>(-1.0, -1.0, 1.0, -1.0, 1.0, 1.0)[i];
          return vec4f(x, y, 0.5, 1.0);
        }`,
      });
      const draw = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: occluder, entryPoint: 'vs' },
        depthStencil: { format: shadow.format, depthWriteEnabled: true, depthCompare: 'less' },
      });
      // x, y: uv; z: depth of the receiver; w: kernel side.
      const module = device.createShaderModule({
        code: `${SHADOW_PCF_WGSL}
@group(0) @binding(0) var map: texture_depth_2d;
@group(0) @binding(1) var cmp: sampler_comparison;
@group(0) @binding(2) var<storage, read> inputs: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> outputs: array<f32>;
@compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id: vec3u) {
  let p = inputs[id.x];
  outputs[id.x] = shadow_pcf(map, cmp, p.xy, p.z, 1.0, i32(p.w));
}`,
      });
      const compute = device.createComputePipeline({
        layout: 'auto',
        compute: { module, entryPoint: 'main' },
      });
      const input = device.createBuffer({
        size: points.length * 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(input, 0, new Float32Array(points.flat()));
      const output = device.createBuffer({
        size: points.length * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
      const read = device.createBuffer({
        size: points.length * 4,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass(shadow.pass());
      pass.setPipeline(draw);
      pass.draw(6);
      pass.end();
      const work = encoder.beginComputePass();
      work.setPipeline(compute);
      work.setBindGroup(
        0,
        device.createBindGroup({
          layout: compute.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: shadow.view },
            { binding: 1, resource: shadow.linear },
            { binding: 2, resource: { buffer: input } },
            { binding: 3, resource: { buffer: output } },
          ],
        }),
      );
      work.dispatchWorkgroups(points.length);
      work.end();
      encoder.copyBufferToBuffer(output, 0, read, 0, points.length * 4);
      device.queue.submit([encoder.finish()]);
      await read.mapAsync(GPUMapMode.READ);
      const result = [...new Float32Array(read.getMappedRange().slice(0))];
      read.unmap();
      for (const buffer of [input, output, read]) buffer.destroy();
      shadow.destroy();
      return result;
    });
  }

  it('shadows what is behind the occluder and nothing else', async () => {
    const [behind, inFront, beside, outside] = await sample([
      [0.2, 0.5, 0.7, 1],
      [0.2, 0.5, 0.3, 1],
      [0.8, 0.5, 0.7, 1],
      [-0.2, 0.5, 0.7, 1],
    ]);
    expect(behind).toBeCloseTo(0, 5);
    expect(inFront).toBeCloseTo(1, 5);
    expect(beside).toBeCloseTo(1, 5);
    // Off the map nothing was drawn, so nothing casts a shadow.
    expect(outside).toBe(1);
  });

  it('softens the edge with a wider kernel', async () => {
    // Exactly on the occluder's edge: one tap is half covered by hardware filtering; a 5×5
    // kernel straddles it the same way. Either way it is partial, not 0 or 1.
    const [one, five] = await sample([
      [0.5, 0.5, 0.7, 1],
      [0.5, 0.5, 0.7, 5],
    ]);
    expect(one).toBeGreaterThan(0.2);
    expect(one).toBeLessThan(0.8);
    expect(five).toBeGreaterThan(0.2);
    expect(five).toBeLessThan(0.8);
  });
});
