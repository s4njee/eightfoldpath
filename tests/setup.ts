import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { create, globals } from 'webgpu';
import { setImageDecoder } from '../src/gpu/assets.ts';

// Dawn's Node bindings stand in for the browser's WebGPU implementation, so GPU code is
// validated by a real implementation without launching a browser.
Object.assign(globalThis, globals);
Object.defineProperty(globalThis.navigator, 'gpu', { value: create([]), configurable: true });

// There is no fetch of local files or createImageBitmap here. A `?url` import resolves to a
// root-relative path such as /assets/sprites/traveller.png, so read the PNG from disk instead.
const root = fileURLToPath(new URL('..', import.meta.url));
setImageDecoder(async (url) => {
  const path = url.startsWith('file:') ? fileURLToPath(url) : join(root, url.split('?')[0]!);
  const png = PNG.sync.read(readFileSync(path));
  return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
});
