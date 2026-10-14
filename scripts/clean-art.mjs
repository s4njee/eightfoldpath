// Turns the raw AI-generated picks in art/ into the cleaned assets in assets/ (stories 1.5, 1.6).
//
//   npm run assets:clean
//
// For each entry in assets/clean.config.json:
//   1. Detect the pixel grid the generator drew on. AI "pixel art" is drawn at roughly 6 to 40
//      screen pixels per art pixel, with soft edges; the grid is the period of the edges.
//   2. Sample one colour per cell (the median of the cell's inner half, which ignores edge blur).
//   3. Key out the magenta background, so alpha is exactly 0 or 255.
//   4. Crop: sprites to their bounding box, others by the configured border.
// Then derive one 48-colour palette in OKLab from every pixel-art asset (k-means), map each of
// them to it, and write assets/palette/, the PNGs, and assets/manifest.json.
//
// The raw art/ folder is not in git (see .gitignore), so this runs on a machine that has it.
// Its output is committed; scripts/check-assets.mjs verifies that output in CI.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PNG } from 'pngjs';

const PALETTE_SIZE = 48;
const config = JSON.parse(readFileSync('assets/clean.config.json', 'utf8'));
const log = existsSync('art/generation-log.json')
  ? JSON.parse(readFileSync('art/generation-log.json', 'utf8'))
  : [];
const selected = existsSync('art/selected.json')
  ? JSON.parse(readFileSync('art/selected.json', 'utf8'))
  : {};

// --- image helpers ------------------------------------------------------------------------

function readPng(path) {
  const png = PNG.sync.read(readFileSync(path));
  return { width: png.width, height: png.height, data: png.data };
}

// PNG chunks as raw byte ranges: length, type, data and CRC, copied verbatim so the CRC stays valid.
function pngChunks(bytes) {
  const chunks = [];
  for (let at = 8; at < bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    chunks.push({ type: bytes.toString('latin1', at + 4, at + 8), bytes: bytes.subarray(at, at + 12 + length) });
    at += 12 + length;
  }
  return chunks;
}

// Meshy marks every image it generates with an XMP block (meshy:AIGenerated, the model and a content
// ID), and its terms (section 2.4) do not allow removing or altering AI identifiers in output. Every
// text chunk of the source therefore goes into the cleaned file unchanged, just after IHDR.
function withSourceText(encoded, sourcePath) {
  const text = sourcePath
    ? pngChunks(readFileSync(sourcePath)).filter((chunk) => ['iTXt', 'tEXt', 'zTXt'].includes(chunk.type))
    : [];
  if (!text.length) return encoded;
  const chunks = pngChunks(encoded);
  return Buffer.concat([
    encoded.subarray(0, 8),
    chunks[0].bytes,
    ...text.map((chunk) => chunk.bytes),
    ...chunks.slice(1).map((chunk) => chunk.bytes),
  ]);
}

function writePng(path, image, sourcePath) {
  mkdirSync(dirname(path), { recursive: true });
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data);
  writeFileSync(path, withSourceText(PNG.sync.write(png, { colorType: 6 }), sourcePath));
}

const at = (img, x, y) => (y * img.width + x) * 4;

// --- 1. grid detection ----------------------------------------------------------------------

function edgeProfile(img, axis) {
  const n = axis === 'x' ? img.width - 1 : img.height - 1;
  const m = axis === 'x' ? img.height : img.width;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < m; j++) {
      const a = axis === 'x' ? at(img, i, j) : at(img, j, i);
      const b = axis === 'x' ? at(img, i + 1, j) : at(img, j, i + 1);
      for (let c = 0; c < 3; c++) sum += Math.abs(img.data[a + c] - img.data[b + c]);
    }
    out[i] = sum;
  }
  return out;
}

function bestPhase(profile, mean, cell) {
  let best = { score: 0, phase: 0 };
  for (let phase = 0; phase < cell; phase += 0.5) {
    let sum = 0;
    let count = 0;
    for (let p = phase; p < profile.length; p += cell) {
      sum += profile[Math.round(p)] ?? 0;
      count++;
    }
    const score = sum / count / mean;
    if (score > best.score) best = { score, phase };
  }
  return best;
}

// Pixel art has square pixels, so one cell size must explain the edges on both axes. The
// smallest size within 70% of the best score is taken: multiples of the true cell also line up
// with edges, and often with the strongest ones (outlines), so the maximum alone overshoots.
export function detectGrid(img) {
  const px = edgeProfile(img, 'x');
  const py = edgeProfile(img, 'y');
  const meanX = px.reduce((a, b) => a + b, 0) / px.length || 1;
  const meanY = py.reduce((a, b) => a + b, 0) / py.length || 1;
  const rows = [];
  for (let cell = 6; cell <= 40; cell += 0.05) {
    const x = bestPhase(px, meanX, cell);
    const y = bestPhase(py, meanY, cell);
    rows.push({ cell, score: (x.score + y.score) / 2, phaseX: x.phase, phaseY: y.phase });
  }
  const max = Math.max(...rows.map((r) => r.score));
  return rows.find((r) => r.score >= 0.7 * max);
}

// --- 2. sampling --------------------------------------------------------------------------------

function sampleGrid(img, grid) {
  const { cell, phaseX, phaseY } = grid;
  const xs = [];
  const ys = [];
  for (let x = phaseX + cell / 2; x < img.width; x += cell) xs.push(x);
  for (let y = phaseY + cell / 2; y < img.height; y += cell) ys.push(y);
  const out = {
    width: xs.length,
    height: ys.length,
    data: new Uint8Array(xs.length * ys.length * 4),
  };
  const r = cell / 4;
  for (let j = 0; j < ys.length; j++) {
    for (let i = 0; i < xs.length; i++) {
      const channels = [[], [], []];
      for (
        let y = Math.max(0, Math.floor(ys[j] - r));
        y <= Math.min(img.height - 1, Math.ceil(ys[j] + r));
        y++
      ) {
        for (
          let x = Math.max(0, Math.floor(xs[i] - r));
          x <= Math.min(img.width - 1, Math.ceil(xs[i] + r));
          x++
        ) {
          const k = at(img, x, y);
          for (let c = 0; c < 3; c++) channels[c].push(img.data[k + c]);
        }
      }
      const o = (j * xs.length + i) * 4;
      for (let c = 0; c < 3; c++) {
        const v = channels[c].sort((a, b) => a - b);
        out.data[o + c] = v[v.length >> 1];
      }
      out.data[o + 3] = 255;
    }
  }
  return out;
}

// --- 3. keying and cropping -------------------------------------------------------------------

const isMagenta = (r, g, b) => r > 100 && b > 100 && g < 90 && Math.abs(r - b) < 100;

function keyMagenta(img) {
  for (let k = 0; k < img.data.length; k += 4) {
    if (isMagenta(img.data[k], img.data[k + 1], img.data[k + 2])) img.data.fill(0, k, k + 4);
  }
}

function crop(img, x0, y0, x1, y1) {
  const out = { width: x1 - x0, height: y1 - y0, data: new Uint8Array((x1 - x0) * (y1 - y0) * 4) };
  for (let y = y0; y < y1; y++) {
    out.data.set(img.data.subarray(at(img, x0, y), at(img, x1, y)), (y - y0) * out.width * 4);
  }
  return out;
}

function cropToContent(img) {
  let x0 = img.width,
    y0 = img.height,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[at(img, x, y) + 3]) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }
  if (x1 < 0) throw new Error('nothing left after keying');
  return crop(img, x0, y0, x1 + 1, y1 + 1);
}

// --- palette ----------------------------------------------------------------------------------

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function oklab(r8, g8, b8) {
  const r = toLinear(r8 / 255),
    g = toLinear(g8 / 255),
    b = toLinear(b8 / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, A, B]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return rgb.map((c) =>
    Math.round(Math.min(1, Math.max(0, toSrgb(Math.min(1, Math.max(0, c))))) * 255),
  );
}

const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

// Weighted k-means over the distinct colours, seeded deterministically (k-means++ with a fixed
// LCG), so the palette is the same on every run.
function derivePalette(images, k) {
  const counts = new Map();
  for (const img of images) {
    for (let p = 0; p < img.data.length; p += 4) {
      if (!img.data[p + 3]) continue;
      const key = (img.data[p] << 16) | (img.data[p + 1] << 8) | img.data[p + 2];
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const points = [...counts].map(([key, w]) => ({
    lab: oklab(key >> 16, (key >> 8) & 255, key & 255),
    w,
  }));
  let seed = 12345;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const centres = [points.reduce((a, b) => (b.w > a.w ? b : a)).lab];
  while (centres.length < k) {
    const d = points.map((p) => p.w * Math.min(...centres.map((c) => dist2(p.lab, c))));
    let pick = rand() * d.reduce((a, b) => a + b, 0);
    let i = 0;
    while ((pick -= d[i]) > 0 && i < d.length - 1) i++;
    centres.push(points[i].lab);
  }
  for (let iteration = 0; iteration < 30; iteration++) {
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (const p of points) {
      let best = 0;
      for (let c = 1; c < k; c++)
        if (dist2(p.lab, centres[c]) < dist2(p.lab, centres[best])) best = c;
      const s = sums[best];
      s[0] += p.lab[0] * p.w;
      s[1] += p.lab[1] * p.w;
      s[2] += p.lab[2] * p.w;
      s[3] += p.w;
    }
    sums.forEach((s, c) => {
      if (s[3]) centres[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
    });
  }
  // Sorted dark to light, so the palette image reads as ramps.
  return centres.map(fromOklab).sort((a, b) => oklab(...a)[0] - oklab(...b)[0]);
}

function mapToPalette(img, palette) {
  const labs = palette.map((c) => oklab(...c));
  const cache = new Map();
  for (let p = 0; p < img.data.length; p += 4) {
    if (!img.data[p + 3]) continue;
    const key = (img.data[p] << 16) | (img.data[p + 1] << 8) | img.data[p + 2];
    let index = cache.get(key);
    if (index === undefined) {
      const lab = oklab(img.data[p], img.data[p + 1], img.data[p + 2]);
      index = 0;
      for (let c = 1; c < labs.length; c++)
        if (dist2(lab, labs[c]) < dist2(lab, labs[index])) index = c;
      cache.set(key, index);
    }
    img.data.set(palette[index], p);
  }
}

// --- main ---------------------------------------------------------------------------------------

const hex = (c) => c.map((v) => v.toString(16).padStart(2, '0')).join('');
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

const results = [];
for (const entry of config.assets) {
  if (!existsSync(entry.from))
    throw new Error(`Missing raw file ${entry.from}; is art/ on this machine?`);
  const out = join('assets', entry.to);
  const result = { entry, out };
  if (entry.kind === 'copy') {
    results.push(result);
    continue;
  }
  const raw = readPng(entry.from);
  if (entry.kind === 'mask') {
    // Line art on black: keep the resolution, collapse to grey luminance.
    for (let p = 0; p < raw.data.length; p += 4) {
      const v = Math.round((raw.data[p] + raw.data[p + 1] + raw.data[p + 2]) / 3);
      raw.data.set([v, v, v, 255], p);
    }
    result.image = raw;
    results.push(result);
    continue;
  }
  const grid = entry.cell
    ? { cell: entry.cell, phaseX: entry.phase?.[0] ?? 0, phaseY: entry.phase?.[1] ?? 0, score: 0 }
    : detectGrid(raw);
  let img = sampleGrid(raw, grid);
  if (entry.key !== false && entry.kind !== 'tile') keyMagenta(img);
  if (entry.crop)
    img = crop(
      img,
      entry.crop[0],
      entry.crop[1],
      img.width - entry.crop[2],
      img.height - entry.crop[3],
    );
  if (entry.kind === 'sprite') img = cropToContent(img);
  Object.assign(result, { image: img, grid });
  results.push(result);
}

const paletted = results.filter(
  (r) => r.image && r.entry.kind !== 'mask' && r.entry.palette !== false,
);
const palette = derivePalette(
  paletted.map((r) => r.image),
  PALETTE_SIZE,
);
for (const r of paletted) mapToPalette(r.image, palette);

mkdirSync('assets/palette', { recursive: true });
writeFileSync('assets/palette/eightfold.hex', palette.map(hex).join('\n') + '\n');
const swatch = { width: palette.length, height: 1, data: new Uint8Array(palette.length * 4) };
palette.forEach((c, i) => swatch.data.set([...c, 255], i * 4));
writePng('assets/palette/eightfold.png', swatch);

const byFile = Object.fromEntries(log.map((e) => [e.file, e]));
const manifest = {
  palette: 'palette/eightfold.hex',
  files: {
    'palette/eightfold.hex': {
      kind: 'palette',
      source: 'derived by scripts/clean-art.mjs (k-means in OKLab over the pixel-art assets)',
      licence: 'MIT (this repository)',
    },
    'palette/eightfold.png': {
      kind: 'palette',
      source: 'palette/eightfold.hex as a 48 × 1 swatch',
      licence: 'MIT (this repository)',
    },
  },
};
for (const r of results) {
  if (r.entry.kind === 'copy') {
    mkdirSync(dirname(r.out), { recursive: true });
    copyFileSync(r.entry.from, r.out);
  } else {
    writePng(r.out, r.image, r.entry.from);
  }
  const variant = selected[r.entry.from.replace(/^art\//, '')]?.from;
  const generated = byFile[variant ? `art/${variant}` : r.entry.from];
  manifest.files[r.entry.to] = {
    kind: r.entry.kind,
    source: variant ? `art/${variant}` : r.entry.from,
    sourceSha256: sha256(r.entry.from),
    generator: generated
      ? {
          tool: 'Meshy',
          mode: generated.mode,
          model: generated.model,
          taskId: generated.task_id ?? generated.refine_task_id,
          prompt: generated.prompt,
        }
      : undefined,
    licence: config.licence,
    ...(r.image && r.entry.kind !== 'mask' ? { size: [r.image.width, r.image.height] } : {}),
    ...(r.grid ? { cell: Number(r.grid.cell.toFixed(2)) } : {}),
    palette: paletted.includes(r) ? 'eightfold' : null,
    ...(r.entry.kind === 'tile' ? { seamless: false } : {}),
    ...(r.entry.note ? { note: r.entry.note } : {}),
  };
  const size = r.image ? `${r.image.width}×${r.image.height}` : 'copied';
  console.log(
    `${r.entry.to.padEnd(34)} ${size.padEnd(10)} ${r.grid ? `cell ${r.grid.cell.toFixed(2)}` : ''}`,
  );
}
writeFileSync('assets/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(`\n${results.length} assets, ${palette.length}-colour palette.`);
