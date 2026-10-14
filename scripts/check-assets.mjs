// Fails the build when an asset is not what the manifest says it is (story 1.5).
//
//   npm run assets:check
//
// Every file under assets/ must have an entry in assets/manifest.json with a source and a licence,
// and every entry must exist. A PNG with a size must have exactly that size. A PNG mapped to the
// project palette may only use the palette's colours, and its alpha must be exactly 0 or 255:
// partial transparency is anti-aliasing the cleanup failed to remove.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PNG } from 'pngjs';

const root = 'assets';
const ignored = new Set(['manifest.json', 'clean.config.json']);
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const palette = new Set(
  readFileSync(join(root, manifest.palette), 'utf8')
    .split(/\s+/)
    .filter(Boolean)
    .map((hex) => parseInt(hex, 16)),
);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [relative(root, path)];
  });
}

const problems = [];
const files = walk(root).filter((file) => !ignored.has(file) && !file.endsWith('.DS_Store'));

for (const file of files) {
  if (!manifest.files[file]) problems.push(`${file}: not listed in assets/manifest.json`);
}

for (const [file, entry] of Object.entries(manifest.files)) {
  const path = join(root, file);
  if (!existsSync(path)) {
    problems.push(`${file}: listed in the manifest but missing`);
    continue;
  }
  if (!entry.source) problems.push(`${file}: no source`);
  if (!entry.licence) problems.push(`${file}: no licence`);
  if (!file.endsWith('.png')) continue;

  const png = PNG.sync.read(readFileSync(path));
  if (entry.size && (png.width !== entry.size[0] || png.height !== entry.size[1])) {
    problems.push(`${file}: is ${png.width}×${png.height}, manifest says ${entry.size.join('×')}`);
  }
  if (entry.palette !== 'eightfold') continue;

  let offPalette = 0;
  let partialAlpha = 0;
  for (let p = 0; p < png.data.length; p += 4) {
    const alpha = png.data[p + 3];
    if (alpha !== 0 && alpha !== 255) partialAlpha++;
    if (alpha === 0) continue;
    const rgb = (png.data[p] << 16) | (png.data[p + 1] << 8) | png.data[p + 2];
    if (!palette.has(rgb)) offPalette++;
  }
  if (offPalette) problems.push(`${file}: ${offPalette} texels use colours outside the palette`);
  if (partialAlpha) problems.push(`${file}: ${partialAlpha} texels have partial alpha`);
}

if (problems.length) {
  console.error(`Asset check failed:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`Asset check: ${Object.keys(manifest.files).length} assets match the manifest.`);
