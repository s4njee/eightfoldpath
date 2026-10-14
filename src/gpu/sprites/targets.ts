/*
 * Colour and depth attachments for a diorama pass, optionally multisampled.
 *
 * With MSAA the pass draws into a multisampled colour target that resolves into the HDR tail's
 * scene view, plus a multisampled depth buffer. Depth cannot be resolved in WebGPU, so a later
 * pass that needs depth (depth of field, story 5.1) reads the multisampled texture with textureLoad
 * (docs/support-matrix.md). Without MSAA the pass draws straight into the scene view.
 */

export interface SceneTargets {
  readonly sampleCount: number;
  readonly depth: GPUTexture;
  setSampleCount(count: 1 | 4): void;
  resize(width: number, height: number): void;
  /** A pass that clears and draws into `sceneView` (resolving into it when multisampled). */
  pass(
    sceneView: GPUTextureView,
    clear: readonly [number, number, number, number],
    timestampWrites?: GPURenderPassTimestampWrites,
  ): GPURenderPassDescriptor;
  destroy(): void;
}

export function createSceneTargets(
  device: GPUDevice,
  options: { colorFormat: GPUTextureFormat; depthFormat?: GPUTextureFormat; label?: string },
): SceneTargets {
  const label = options.label ?? 'scene';
  const depthFormat = options.depthFormat ?? 'depth24plus';
  let sampleCount: 1 | 4 = 1;
  let width = 1;
  let height = 1;
  let color: GPUTexture | undefined;
  let depth: GPUTexture | undefined;

  function allocate() {
    color?.destroy();
    depth?.destroy();
    color =
      sampleCount > 1
        ? device.createTexture({
            label: `${label} msaa colour`,
            size: [width, height],
            format: options.colorFormat,
            sampleCount,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
          })
        : undefined;
    depth = device.createTexture({
      label: `${label} depth`,
      size: [width, height],
      format: depthFormat,
      sampleCount,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
  }
  allocate();

  return {
    get sampleCount() {
      return sampleCount;
    },
    get depth() {
      return depth!;
    },
    setSampleCount(count) {
      if (count === sampleCount) return;
      sampleCount = count;
      allocate();
    },
    resize(nextWidth, nextHeight) {
      if (nextWidth === width && nextHeight === height) return;
      width = Math.max(1, nextWidth);
      height = Math.max(1, nextHeight);
      allocate();
    },
    pass(sceneView, clear, timestampWrites) {
      return {
        label: `${label} pass`,
        colorAttachments: [
          {
            view: color ? color.createView() : sceneView,
            resolveTarget: color ? sceneView : undefined,
            loadOp: 'clear',
            // The multisampled samples are not needed once resolved.
            storeOp: color ? 'discard' : 'store',
            clearValue: [...clear],
          },
        ],
        depthStencilAttachment: {
          view: depth!.createView(),
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
          depthClearValue: 1,
        },
        timestampWrites,
      };
    },
    destroy() {
      color?.destroy();
      depth?.destroy();
    },
  };
}
