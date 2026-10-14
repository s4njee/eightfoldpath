#!/usr/bin/env node
// Generate the test art in prompts.md through the Meshy API.
//
//   node scripts/meshy.mjs                         plan the first batch and estimate credits (no API calls)
//   node scripts/meshy.mjs --go                    generate it
//   node scripts/meshy.mjs --only 1,12 --go        generate selected prompts by number
//   node scripts/meshy.mjs --batch later|all       choose the batch (default: first)
//   node scripts/meshy.mjs --variations 2          images per prompt (default: 4)
//   node scripts/meshy.mjs --model nano-banana     text-to-image model (default: nano-banana-2)
//
// The key is read from MESHY_API_KEY, or from MESHY_API_KEY=... in eightfoldpath/.env, which is
// git-ignored. The script never prints it. Existing output files are skipped, so a run can be
// repeated safely. Every task is appended to art/generation-log.json for provenance.
//
// A task is recorded in art/.meshy-pending.json as soon as Meshy accepts it, and removed once its
// file is saved. If a run dies after paying for a task (a dropped connection while polling or
// downloading), the next run resumes that task instead of paying for a new one.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.meshy.ai/openapi';
const IMAGE_CREDITS = {
  'nano-banana': 3,
  'nano-banana-2': 6,
  'nano-banana-2-lite': 3,
  'nano-banana-pro': 9,
  'gpt-image-2': 9,
  'gpt-image-2-5-flare': 9,
  'gpt-image-2-5-sunburst': 9,
};
// Shapes that suit something other than a square canvas.
const ASPECT = {
  1: '3:4',
  3: '3:4',
  4: '3:4',
  6: '3:4',
  8: '3:4',
  5: '16:9',
  18: '16:9',
  22: '16:9',
  23: '16:9',
  24: '16:9',
  25: '16:9',
  26: '16:9',
  27: '16:9',
  28: '16:9',
  29: '16:9',
  31: '4:3',
};
const TEXTURE_PROMPT =
  'Pixel-art textures with large visible texels. Plain flat-colour textures with no baked lighting, no painted shadows, no ambient occlusion, nothing glowing.';
// Per-model settings. Without remeshing, meshy-6 returned one mesh of 0.5-1.4 million triangles
// (18-44 MB), and the text texture prompt did not produce pixel art; a reference image of our own
// pixel art steers the texture instead (Meshy uses texture_prompt over texture_image_url if both are sent).
const MODEL_OPTIONS = {
  33: { polycount: 30000, reference: 'art/reference/town-square-texref.png' },
  34: { polycount: 30000, reference: 'art/reference/forest-clearing-texref.png' },
  35: { polycount: 15000, reference: 'art/characters/traveller.png' },
};

function dataUri(file) {
  const ext = extname(file).slice(1).replace('jpg', 'jpeg');
  return `data:image/${ext};base64,${readFileSync(join(root, file)).toString('base64')}`;
}

function parseArgs(argv) {
  const args = { batch: 'first', variations: 4, model: 'nano-banana-2', go: false, only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--go') args.go = true;
    else if (a === '--batch') args.batch = argv[++i];
    else if (a === '--variations') args.variations = Number(argv[++i]);
    else if (a === '--model') args.model = argv[++i];
    else if (a === '--only') args.only = argv[++i].split(',').map(Number);
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!['first', 'later', 'all'].includes(args.batch))
    throw new Error('--batch must be first, later or all');
  if (!(args.variations >= 1 && args.variations <= 8))
    throw new Error('--variations must be 1 to 8');
  if (!(args.model in IMAGE_CREDITS))
    throw new Error(`--model must be one of ${Object.keys(IMAGE_CREDITS).join(', ')}`);
  return args;
}

// prompts.md: "## First batch" / "## Later batch", then per item
// "### N. Title — *Image|3D*", a line starting with `art/...`, and a ```text block.
function parsePrompts() {
  const md = readFileSync(join(root, 'prompts.md'), 'utf8');
  const items = [];
  let batch = null;
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^## First batch/.test(line)) batch = 'first';
    else if (/^## Later batch/.test(line)) batch = 'later';
    const h = line.match(/^### (\d+)\. (.+?) — \*(Image|3D)\*\s*$/);
    if (!h || !batch) continue;
    const item = { number: Number(h[1]), title: h[2], mode: h[3], batch, file: null, prompt: null };
    for (let j = i + 1; j < lines.length && !lines[j].startsWith('### '); j++) {
      const f = lines[j].match(/^`(art\/[^`]+)`/);
      if (f && !item.file) item.file = f[1];
      if (lines[j].trim() === '```text' && !item.prompt) {
        const body = [];
        for (j++; j < lines.length && lines[j].trim() !== '```'; j++) body.push(lines[j]);
        item.prompt = body.join(' ').trim();
      }
    }
    if (!item.file || !item.prompt)
      throw new Error(`Could not parse prompt ${item.number} in prompts.md`);
    items.push(item);
  }
  return items;
}

function apiKey() {
  if (!process.env.MESHY_API_KEY && existsSync(join(root, '.env'))) {
    process.loadEnvFile(join(root, '.env'));
  }
  const key = process.env.MESHY_API_KEY;
  if (!key) throw new Error('Set MESHY_API_KEY, or put MESHY_API_KEY=... in eightfoldpath/.env');
  return key;
}

function describe(e) {
  const cause = e.cause?.code ?? e.cause?.message;
  return cause ? `${e.message} (${cause})` : e.message;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retries network errors, 429 and 5xx. Only used for requests that are safe to repeat:
// creating a task is not retried, because a lost response may still have been charged.
async function fetchRetry(url, init = {}, tries = 5) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, init);
      if ((res.status === 429 || res.status >= 500) && attempt < tries)
        throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      if (attempt >= tries) throw new Error(`${describe(e)} after ${tries} attempts`, { cause: e });
      await sleep(1000 * 2 ** attempt);
    }
  }
}

const headers = (key) => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' });

async function create(key, path, body) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: headers(key),
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(
      `creating the task failed: ${describe(e)}. It may still have been created; check Meshy's task list before retrying`,
      { cause: e },
    );
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text).result;
}

async function waitFor(key, path, minutes) {
  const deadline = Date.now() + minutes * 60_000;
  for (;;) {
    const res = await fetchRetry(`${API}${path}`, { headers: headers(key) });
    const text = await res.text();
    if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${text.slice(0, 300)}`);
    const task = JSON.parse(text);
    if (task.status === 'SUCCEEDED') return task;
    if (task.status === 'FAILED' || task.status === 'CANCELED') {
      throw new Error(`${path} ${task.status}: ${task.task_error?.message ?? 'no message'}`);
    }
    if (Date.now() > deadline)
      throw new Error(`${path} timed out after ${minutes} min (last progress ${task.progress}%)`);
    await sleep(5000);
  }
}

async function download(url, target) {
  const res = await fetchRetry(url);
  if (!res.ok) throw new Error(`download → ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  const ext = type.includes('jpeg')
    ? '.jpg'
    : type.includes('webp')
      ? '.webp'
      : extname(target) || '.png';
  const out = target.replace(/\.[^.]+$/, '') + ext;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  return out;
}

const rel = (p) => p.slice(root.length + 1);

const logPath = join(root, 'art/generation-log.json');
function log(entry) {
  const entries = existsSync(logPath) ? JSON.parse(readFileSync(logPath, 'utf8')) : [];
  entries.push(entry);
  mkdirSync(dirname(logPath), { recursive: true });
  writeFileSync(logPath, JSON.stringify(entries, null, 2) + '\n');
}

const pendingPath = join(root, 'art/.meshy-pending.json');
const readPending = () =>
  existsSync(pendingPath) ? JSON.parse(readFileSync(pendingPath, 'utf8')) : {};
function setPending(target, value) {
  const pending = readPending();
  if (value) pending[target] = value;
  else delete pending[target];
  mkdirSync(dirname(pendingPath), { recursive: true });
  writeFileSync(pendingPath, JSON.stringify(pending, null, 2) + '\n');
}

function variantPath(file, v) {
  return join(root, file.replace(/(\.[^.]+)$/, `-v${v}$1`));
}

const exists = (target) =>
  ['.png', '.jpg', '.webp', '.glb'].some((e) => existsSync(target.replace(/\.[^.]+$/, e)));

async function generateImage(key, item, target, model) {
  const aspect = ASPECT[item.number] ?? '1:1';
  let id = readPending()[rel(target)]?.task_id;
  if (!id) {
    id = await create(key, '/v1/text-to-image', {
      ai_model: model,
      prompt: item.prompt,
      aspect_ratio: aspect,
    });
    setPending(rel(target), { task_id: id, kind: 'image', number: item.number, model });
  }
  const task = await waitFor(key, `/v1/text-to-image/${id}`, 10);
  const out = await download(task.image_urls[0], target);
  log({
    number: item.number,
    file: rel(out),
    mode: 'text-to-image',
    model: task.ai_model ?? model,
    aspect_ratio: aspect,
    prompt: item.prompt,
    task_id: id,
    consumed_credits: task.consumed_credits,
    finished_at: new Date(task.finished_at).toISOString(),
  });
  setPending(rel(target), null);
  return out;
}

async function generateModel(key, item, target) {
  const state = readPending()[rel(target)] ?? { kind: 'model', number: item.number };
  const options = MODEL_OPTIONS[item.number] ?? {};
  if (!state.preview_task_id) {
    state.preview_task_id = await create(key, '/v2/text-to-3d', {
      mode: 'preview',
      prompt: item.prompt,
      ai_model: 'meshy-6',
      target_formats: ['glb'],
      origin_at: 'bottom',
      ...(options.polycount && {
        should_remesh: true,
        topology: 'triangle',
        target_polycount: options.polycount,
      }),
    });
    setPending(rel(target), state);
  }
  const p = await waitFor(key, `/v2/text-to-3d/${state.preview_task_id}`, 20);
  if (!state.refine_task_id) {
    // remove_lighting only applies to meshy-6, which is why the preview pins that model.
    const texture =
      options.reference && existsSync(join(root, options.reference))
        ? { texture_image_url: dataUri(options.reference) }
        : { texture_prompt: TEXTURE_PROMPT };
    state.refine_task_id = await create(key, '/v2/text-to-3d', {
      mode: 'refine',
      preview_task_id: state.preview_task_id,
      ...texture,
      remove_lighting: true,
      enable_pbr: false,
      target_formats: ['glb'],
    });
    setPending(rel(target), state);
  }
  const r = await waitFor(key, `/v2/text-to-3d/${state.refine_task_id}`, 20);
  const out = await download(r.model_urls.glb, target);
  if (r.thumbnail_url)
    await download(r.thumbnail_url, target.replace(/\.glb$/, '-thumb.png')).catch(() => {});
  log({
    number: item.number,
    file: rel(out),
    mode: 'text-to-3d',
    model: 'meshy-6',
    prompt: item.prompt,
    ...(options.polycount && { target_polycount: options.polycount }),
    ...(options.reference
      ? { texture_reference: options.reference }
      : { texture_prompt: TEXTURE_PROMPT }),
    preview_task_id: state.preview_task_id,
    refine_task_id: state.refine_task_id,
    consumed_credits: (p.consumed_credits ?? 0) + (r.consumed_credits ?? 0),
    finished_at: new Date(r.finished_at).toISOString(),
  });
  setPending(rel(target), null);
  return out;
}

async function pool(jobs, size) {
  const results = [];
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++];
      try {
        results.push({ ok: true, label: job.label, out: await job.run() });
        console.log(`  done  ${job.label}`);
      } catch (e) {
        results.push({ ok: false, label: job.label, error: describe(e) });
        console.log(`  FAIL  ${job.label}: ${describe(e)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: size }, worker));
  return results;
}

const args = parseArgs(process.argv.slice(2));
const items = parsePrompts().filter((it) =>
  args.only ? args.only.includes(it.number) : args.batch === 'all' || it.batch === args.batch,
);
const pending = readPending();

const jobs = [];
for (const item of items) {
  const targets =
    item.mode === 'Image'
      ? Array.from({ length: args.variations }, (_, i) => [
          variantPath(item.file, i + 1),
          ` v${i + 1}`,
        ])
      : [[join(root, item.file), ' (3D)']];
  for (const [target, suffix] of targets) {
    if (exists(target)) continue;
    const resume = Boolean(pending[rel(target)]);
    const credits = item.mode === 'Image' && !resume ? IMAGE_CREDITS[args.model] : 0;
    jobs.push({
      item,
      target,
      resume,
      credits,
      label: `${item.number}. ${item.title}${suffix}${resume ? ' (resume, already paid)' : ''}`,
    });
  }
}

const imageJobs = jobs.filter((j) => j.item.mode === 'Image' && !j.resume);
const modelJobs = jobs.filter((j) => j.item.mode === '3D' && !j.resume);
const resumed = jobs.filter((j) => j.resume);
console.log(
  `${imageJobs.length} new images with ${args.model} at ${IMAGE_CREDITS[args.model]} credits each: ${imageJobs.reduce((s, j) => s + j.credits, 0)} credits`,
);
console.log(
  `${modelJobs.length} new 3D models (preview + refine with meshy-6): check Meshy's pricing page for the cost`,
);
if (resumed.length) console.log(`${resumed.length} unfinished tasks to resume at no extra cost`);
for (const j of jobs) console.log(`  ${j.label}`);

if (!args.go) {
  console.log('\nPlan only. Add --go to generate.');
} else if (jobs.length) {
  const key = apiKey();
  for (const j of jobs) {
    j.run =
      j.item.mode === 'Image'
        ? () => generateImage(key, j.item, j.target, args.model)
        : () => generateModel(key, j.item, j.target);
  }
  const results = await pool(jobs, 3);
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${results.length - failed.length} succeeded, ${failed.length} failed. Log: art/generation-log.json`,
  );
  if (Object.keys(readPending()).length)
    console.log(
      'Unfinished tasks are in art/.meshy-pending.json; run the same command again to resume them.',
    );
  process.exitCode = failed.length ? 1 : 0;
}
