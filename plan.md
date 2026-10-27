# Eightfold Path — WebGPU effects in the HD-2D style

A research site that recreates, measures and documents the effects that define HD-2D games such as Octopath Traveler: pixel-art sprites and tiles lit like a modern 3D scene, seen through a tilt-shift lens, with bloom, light shafts, weather and a full kit of battle effects. It is judged by two questions: **does it look like it belongs in a game of this style**, and **would you actually ship it on a website?** Every effect gets a live demo, readable source, a write-up and a practicality scorecard.

Sibling of [Fire Temple](../firetemple/plan.md) and [Water Temple](../watertemple/plan.md), and the first project to start on the shared temple core rather than a copy. The ideas behind it are in the HD-2D section of [research.md](../research.md).

## Goals

- Recreate the signature effects of the genre one technique at a time, so each can be understood and reused alone: the lens, the lighting, the weather, the battle effects and the screen transitions.
- Build a small, composable scene kit (tiles, sprites, lights, camera, post) that the effects share, without becoming a game engine.
- Show each effect in a realistic web context as well as a game one: a hero section, a card, a dialogue box, a notification.
- Record what each effect costs: GPU time, bundle size, asset bytes, device coverage, fallback story.
- Be library-first from the first effect. Every effect is importable through the library entry and the HoloGPU contract, not only viewable in the gallery.

## Non-goals

- A game engine. No gameplay, collision, pathfinding, save state, input mapping beyond pointer and scroll, or audio. Scenes are dioramas with scripted motion.
- Recreating any game's assets, characters, interface designs, fonts, logos or music. Effects are rebuilt from technique, with original or openly licensed art. Reference screenshots are linked from notes, never committed.
- Using "HD-2D" as a product, package or effect name. It is Square Enix's name for the style and they have reportedly filed trademarks for it. Describing the style with it, as this plan does, is a different matter.
- Full WebGL2 parity. WebGL2 ports are done only where the comparison is the research.

## Decisions

Defaults chosen so work can start. Each is cheap to revisit before Epic 1 is finished.

| Decision            | Default                                                                                  | Why                                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundation          | `@mk7s/hologpu-temple-core` for the GPU core and WGSL library; Fire Temple's shell copied | The core was extracted from Fire and Water Temple for exactly this (holofx backlog 3.5). The shell is not in the core, and Fire Temple's is the newest.              |
| Upstream rule       | Anything general goes into temple-core, not into this repo                                | Shadow maps, MSAA targets and the sprite renderer are useful to every temple. A third private copy of shared code is what 3.5 just undid.                             |
| Library entry       | `src/lib` host and generated registry from story 1.3, as Fire Temple has them now         | Both temples retrofitted these late (holofx backlog 3.3, 3.4). Starting with them costs nothing.                                                                     |
| Effect contract     | Identical to Fire Temple's, presented through the HoloGPU contract by the ADR-020 adapter | One public API for the whole collection. Effects can move between temples.                                                                                           |
| Build tooling       | Vite + TypeScript (strict), versions matched to Fire Temple                              | Same as the siblings.                                                                                                                                                |
| Shader loading      | temple-core's `vite-plugin-wgsl.ts`: per-effect chunks, includes resolved at build time   | Already solved the eager-WGSL problem in both temples.                                                                                                               |
| Rendering           | A small forward renderer on temple-core's `scene/` module, plus a sprite batcher           | The look needs depth, real lights and shadows. Most temple effects are fullscreen 2D; this project is scene-first.                                                   |
| Colour pipeline     | Linear HDR `rgba16float` scene → fog and shafts → depth of field → bloom → grade and tonemap → finishing → sRGB | Emissive pixels must glow without smearing. The order is a starting point; story 5.10 measures it.                                                     |
| Render paths        | HD path by default (full-resolution lighting over pixel textures); a low-resolution path as a second option | The HD path is the look of the genre. The low-resolution path (everything quantised to the pixel grid) is cheaper and is its own style; 13.3 compares them. |
| Pixel scale         | One tile is one world unit and 16 texels; sprites use the same texel density             | A shared density keeps sprites, tiles and props consistent and makes the texel grid something effects can rely on.                                                   |
| Camera              | Perspective, narrow field of view (about 25°), pitched about 35° down                     | The diorama read. Orthographic is a comparison, not the default.                                                                                                    |
| Palette             | One original 48-colour palette authored in OKLab for the test kit                         | Published palettes carry their own licences; an original one avoids the question and lets the palette tools be tuned to it.                                         |
| Art                 | A small AI-generated test set, not game assets; every file in a manifest with its prompt and tool ([art.md](art.md)) | The review of the other four repos found three images with licence or provenance problems. This project depends on art more than any of them.                      |
| Controls            | Tweakpane, generated from each effect's param schema                                     | Same as the siblings.                                                                                                                                                |
| Math                | `wgpu-matrix`                                                                            | Same as the siblings.                                                                                                                                                |
| Testing             | Vitest on Dawn's Node bindings, with the flash analyser from the first effect            | Real WebGPU without a browser. Battle effects are flash-heavy by nature.                                                                                             |
| Measurement         | Fire Temple's `study` harness, one cost study per epic                                    | Proven there.                                                                                                                                                        |
| Hosting             | Static build; the holofx site serves it as a lab                                          | No server needed.                                                                                                                                                    |
| No-WebGPU behaviour | Poster or looped video per effect; CSS-only versions of the interface components          | Honest fallback.                                                                                                                                                     |

## Carried over from the temples

Findings that shape this plan rather than being rediscovered.

- **Per-pass GPU timings are indicative only.** Time a frame from first pass start to last pass end, repeat light workloads and take the slope, run with nothing else on the GPU. Dawn under Node has a floor near 0.1 ms; Chrome's is near 1 ms.
- **Chrome's own frame time is the stricter test.** Eight of Fire Temple's first thirteen scenes were over the budget first given to them once Chrome's reading was taken. Measure both from the start.
- **A baked noise texture made Tier A possible.** Fire Temple's Epic 4 fit Tier A where Epic 3's procedural scenes did not. Prefer textures and early-outs over per-pixel procedural noise.
- **Run the flash analyser from the first effect.** It caught three Fire Temple presets that looked harmless. Spells, hit flashes and storms will be worse.
- **Emissive effects over a light page need a decision.** Fire Temple's default is luminance alpha with a 0.3 underlay (`docs/compositing-study.md`). Spell effects over page content inherit that answer.
- **Arbitrary live DOM capture is not a shipped path.** Transitions that break "the screen" into pieces capture the canvas, not the page.
- **CI on software Vulkan finds Metal-only assumptions.** Fire Temple's first run did. Get it green in Epic 1.
- **Effect metadata ends up in the first load.** Keep `meta.ts` small and the scorecard text lazy (Fire Temple 12.1).

## Practicality tiers

Every effect is tagged with a tier. Budgets are starting targets to be validated in Epic 13.

| Tier            | Meaning                                             | Shape                                                  | GPU budget @1080p                   |
| --------------- | --------------------------------------------------- | ------------------------------------------------------ | ----------------------------------- |
| **A** Drop-in   | Safe as ambient decoration, including mobile        | One or two passes, a few sprites, no shadows           | ≤ 2 ms on integrated GPU            |
| **B** Feature   | Hero sections and interactive set pieces            | A lit diorama or a particle effect with post           | ≤ 6 ms on integrated GPU            |
| **C** Showpiece | Dedicated page or landing experience, desktop-first | A full scene: many lights, shadows, the whole lens     | ≤ 12 ms on discrete / Apple Silicon |

Budgets include the post chain the effect uses. Depth of field is the most likely stage to push an effect up a tier, so its cost is a baseline row in every study, as Fire Temple's HDR tail is.

## Architecture sketch

```
eightfoldpath/
  index.html
  vite.config.ts
  assets/
    manifest.json      every file: path, source, author, licence, URL; CI fails on a missing entry
    palette/           the project palette and its ramps
    kit/               the pixel-art test kit (1.6)
    scenes/            scene files: tile map, height map, scene.json
  src/
    main.ts            bootstrap: one shared GPU session, mounts an effect
    lib/               library host and mount(), as in Fire Temple; no registry, DOM or CSS
    gpu/               re-exports from temple-core, plus what is specific to this project:
                       pixel/ (texel sampling, palette, outlines, low-resolution path),
                       sprites/ (batcher, flipbooks, sprite lighting and shadows),
                       diorama/ (scene loader, tile extruder, lights, shadows, water),
                       lens/ (depth of field, shafts, fog, grade, finishing),
                       vfx/ (particles, ribbons, timeline, screen effects)
    wgsl/              chunks specific to this project; the shared library comes from temple-core
    effects/<id>/      meta.ts (eager), index.ts + *.wgsl (lazy chunk), notes.md, poster.webp
    effects/registry.generated.ts   written by scripts/registry.mjs
    shell/             copied from Fire Temple: gallery, effect page, panels, HUD, motion controls
  tests/               vitest on Dawn's Node bindings
  experiments/         scratch sweeps and probes; not part of the test run
  docs/                research output: support matrix, cost studies
```

Effect contract: identical to Fire Temple's, so effects and shell code can move between repos and the ADR-020 adapter presents every effect through HoloGPU's `createEffect` and `attach`.

```ts
// src/effects/<id>/index.ts exports `effect`; meta.ts exports `meta`.
export interface EffectModule<S extends ParamSchema> {
  meta: { id: string; title: string; epic: string; tier: 'A' | 'B' | 'C'; tags: string[] };
  params: S; // drives controls, docs table, URL state
  presets?: Record<string, Partial<ParamValues<S>>>;
  create(ctx: EffectContext<S>): Promise<EffectInstance>; // ctx: device, format, canvas, live params
}

export interface EffectInstance {
  resize(width: number, height: number, dpr: number): void;
  frame(time: FrameTime, encoder: GPUCommandEncoder, target: GPUTextureView): void;
  destroy(): void;
}
```

Effects that need art receive it through their params or options as URLs the caller controls (story 12.2), so the library path never depends on a bundler's asset handling.

## Definition of done (per effect story)

1. Runs inside its tier budget on the reference devices, measured on Dawn (`npm run study`) and as one frame in Chrome (`npm run browser-check`). Until the device matrix exists (13.2), A and B labels are provisional and the scorecard says so.
2. Parameters exposed through the schema, with at least two presets.
3. Handles resize, DPR changes, device loss, offscreen pause and `prefers-reduced-motion`. Reduced motion turns off shake, hit-stop, flashes and animated focus.
4. Stays under the flash threshold (WCAG 2.3.1) at default settings. Any preset over it is declared in `scorecard.flashPresets` and labelled.
5. Holds still under motion: no texel shimmer when the camera pans at the default speed, checked with the loupe (2.4).
6. Mounts through `src/lib` and through HoloGPU's `createEffect`, in a test.
7. Every asset it uses is in `assets/manifest.json` with a licence.
8. Shown in at least one realistic web context over dark and light pages, and a phone-sized viewport.
9. `notes.md` written: how it works, what it recreates, cost, pitfalls, when to use it, references.
10. Scorecard filled in and fallback poster captured.

## Milestones

| Milestone             | Scope                                                        | Proves                                                     |
| --------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- |
| **M0** Vertical slice | Epic 1, stories 2.1–2.2, 3.1–3.2, 4.1–4.3, 5.1, effect 9.4   | Art → sprites in a diorama → the lens → shell → library    |
| **M1** Drop-in set    | Rest of Epic 3, stories 5.2–5.4 and 5.7–5.8, 9.1–9.6         | A Tier A library of the look, usable on ordinary pages     |
| **M2** The world      | Rest of Epics 4 and 5, Epic 6                                | A lit, living diorama with weather and time of day        |
| **M3** Battle         | Epics 7 and 8, story 13.2                                    | A data-driven effects toolkit, measured on several devices |
| **M4** Eight scenes   | Epics 10 and 11, rest of Epic 9                              | The upper bound, and heroes for the holofx site            |
| **M5** Findings       | Epics 12 and 13                                              | Published conclusions                                      |

Story format: `ID Title [tier] (size)`. Sizes: S ≈ a day or less, M ≈ a few days, L ≈ a week or more. Building blocks carry no tier; studies are `[—]`.

---

## Epic 1 — Foundation and tooling

Everything needed before the first effect can exist. Unlike the temples, the GPU core is a dependency rather than a copy, and the library entry exists before the first effect.

- [x] **1.1 Repo scaffold** (S) — `git init`, create `s4njee/eightfoldpath`, MIT `LICENSE`, `CREDITS.md`, README, Vite `vanilla-ts`, strict TS, `@webgpu/types`, ESLint + Prettier, scripts matched to Fire Temple. Add it to the holofx superproject as a fifth submodule and to `scripts/build-labs.mjs`. _Done. Private repo [s4njee/eightfoldpath](https://github.com/s4njee/eightfoldpath), private at first while the art's licence was checked; it is now confirmed (CREDITS.md). Added to holofx as the fifth submodule, to `scripts/build-labs.mjs` (served at `/labs/eightfoldpath/`), `scripts/bootstrap.mjs` and CONTRIBUTING.md._
- [x] **1.2 Depend on temple-core** (S) — device, canvas, targets, passes, post, scene and the shared WGSL library from `@mk7s/hologpu-temple-core`. Record which modules are used. Anything missing is proposed upstream first. _Done. Re-export shims for 25 shared modules (`src/gpu/{canvas,fullscreen,media,mipmap,pointer,profiler,shader,targets,texture,texture-memory,types,uniforms}`, `passes/*`, `post/{bloom,chain,output}`, `scene/*`). Local: `device`, `loop`, `fallback`, `dom-rects`, `shader-overlay`, `post/tail`, and the new `assets.ts`. Fire's emission, particle, simulation, volume and sprite modules were left behind._
- [x] **1.3 Shell, registry and library host** (M) — copy Fire Temple's shell, `scripts/registry.mjs` and `src/lib` (`createEffectHost`, `mount`). A `hello` effect mounts through both the gallery and `src/lib` before Epic 3 starts. _Done. Shell, generated registry and `src/lib` (`createEffectHost`, `mount`) copied from Fire Temple with the `ft-` prefix renamed to `efp-`. `hello` mounts in the gallery and through `src/lib`; `npm run build:lib` emits plain ESM that imports in bare Node, with its art inlined._
- [ ] **1.4 Test and study harness** (M) — port `tests/headless.ts`, `effects.test.ts`, the flash analyser, `study`, `shot`, `posters` and `browser-check`. Add a test that mounts every effect through the ADR-020 adapter. _Partly done. Ported: `tests/headless.ts`, `effects.test.ts`, the flash analyser and per-effect sweep, `study`, `shot` (with `experiments/shot.test.ts`), `posters`, `browser-check`, and the generic unit tests (525 pass). Not done: the test that mounts every effect through HoloGPU's `createEffect`, because the ADR-020 adapter exists only as a spike in the superproject and `@mk7s/hologpu-core` is not published. `browser-check` passes: `hello` starts, draws and animates in all eight views in headless Chrome._
- [x] **1.5 Asset pipeline and manifest** (M) — `assets/manifest.json` (for generated art: tool, model, prompt, seed, references, cleanup steps) and a check that fails the build on an unlisted file, a wrong canvas size, an off-palette colour or partial alpha; image loading with nearest sampling and correct sRGB handling; an atlas packer for sprites and tiles into texture arrays; palette files. _Done. `scripts/clean-art.mjs` detects each image's pixel grid (one square cell size explaining edges on both axes), samples one colour per cell, keys out magenta, crops, derives a 48-colour palette by k-means in OKLab and writes `assets/` with `manifest.json`. `scripts/check-assets.mjs` (part of `npm run build`) fails on an unlisted file, a wrong size, an off-palette colour or partial alpha. `src/gpu/assets.ts` decodes images (swappable decoder; the tests read PNGs from disk) and packs them into a `2d-array` texture._
- [x] **1.6 Test art** (M) — the first batch of the test set in [art.md](art.md): two characters, three props, two tiles, a house front, a palette-cycling waterfall, five parallax layers, a painted illustration and a 3D town diorama. AI-generated from [prompts.md](prompts.md); images that test pixel exactness are cleaned up to a real grid and palette. Nothing in Epics 3 to 6 can be judged without it. _Done, beyond the first batch: all 32 selected images are cleaned (sprites 24 to 83 texels tall, tiles and walls about 99 texels square), plus the town diorama model. The rest of the 3D models stay in `art/` for now. Tiles are not seamless yet (`seamless: false` in the manifest). The art was generated on a paid Meshy plan, which gives ownership of the output, and is MIT licensed with the repository; Meshy's AI-generation metadata is carried into every cleaned image and enforced by the asset check (CREDITS.md)._
- [x] **1.7 CI and deploy** (S) — lint, format, build and tests on software Vulkan, green on GitHub. Done when a run has passed. _Done. The CI workflow (lint, format check, build with the asset and bundle checks, library build, tests on Mesa lavapipe) passed on its first run. No separate deploy: the holofx site serves the build as a lab._
- [x] **1.8 Support matrix delta** (S) — re-check what this project leans on beyond Fire Temple's [support matrix](../firetemple/docs/support-matrix.md): MSAA with `rgba16float`, alpha-to-coverage, texture arrays, depth formats and comparison samplers, `float32-filterable`, `timestamp-query`. _Done: [docs/support-matrix.md](docs/support-matrix.md). 4x MSAA on `rgba16float` with alpha-to-coverage is core (not in compatibility mode); depth cannot be resolved, so depth of field reads multisampled depth with `textureLoad`; `depth32float` with a comparison sampler gives PCF without a feature; timestamps are coarsened to 100 µs or more by spec. Browser behaviour was read from sources, not run._
- [x] **1.9 `hello`** (S) — one lit sprite standing on one tile, through the full post chain. _Done. The traveller sprite on a 64-texel cobblestone tile, lit by an orbiting lantern, through the HDR tail; three presets, notes and a poster. The cleaned traveller is 35 × 68 texels, so at the shared density it stands about four tiles tall instead of two (see its notes)._

## Epic 2 — Site shell and research UX

Ported from Fire Temple, plus tools for a look made of many layers.

- [x] **2.1 Gallery, effect page, HUD, source viewer, notes, scorecard, motion controls** (M) — as Fire Temple's, re-themed. _Done. Ported with the scaffold in 1.3, then re-themed: night indigo (dark) and parchment (light) with a lantern-gold accent; every text and accent pairing is at least 5.0:1 (WCAG AA) in both themes. The lantern sprite is the favicon._
- [x] **2.2 Layer inspector** (M) — view albedo, normals, depth, circle of confusion, shadow maps, light count and each post stage alone; switch any stage off. _Done. Effects declare `inspect: { views, stages }` and read a live `ctx.inspect` each frame; the Inspect panel offers exactly those, with the choice in the URL (`view=`, `off=`). `tests/inspect.test.ts` draws every declared view and every stage switched off, for every effect, and fails if any two look identical. `hello` has albedo, lighting, normals, depth, before-post and bloom-alone views and light, shadow, glow and bloom stages. Circle of confusion, shadow maps and light count arrive with the effects that have them._
- [x] **2.3 Before and after** (S) — a split view of the raw pixel scene against the fully treated one. The clearest way to show what each layer contributes. _Done, in the host rather than per effect: with the split on, the host renders the frame again with every stage off and the clock held, in a second submission (effects upload uniforms with `queue.writeBuffer`, so one command buffer would let the second render overwrite the first's), and copies the left part over the canvas. Draggable and keyboard-movable; `split=` in the URL. It doubles the GPU work while on._
- [x] **2.4 Texel loupe** (S) — a magnifier that overlays the texel grid, for checking sampling, snapping and shimmer. _Done. ×8 magnifier with one cell per canvas pixel, beside the pointer, redrawn after every frame; it reads the WebGPU canvas with `drawImage`, checked in Chrome._
- [x] **2.5 Scorecard fields** (S) — Fire Temple's, plus pixel stability under motion, palette adherence on the low-resolution path, asset bytes, and whether the effect needs depth. _Done. `depth`, `pixelStability` and `paletteAdherence` in the scorecard type and tab; art bytes are computed by `scripts/registry.mjs` from each effect's imports under `assets/`, so they cannot go stale._
- [x] **2.6 In-context layouts** (M) — mock pages in dark and light: a hero with a diorama behind it, a card grid, a dialogue-box component, a notification. _Done. Fire Temple's Hero and Cards layouts cover the first two; new Dialogue and Notification layouts use the cleaned window frame as a pixelated nine-slice border, with the traveller portrait and chest icon. `browser-check` covers both (`dialogue-dark`, `notification-light`)._

## Epic 3 — Pixel building blocks

Shared code that most later effects depend on. Each is proven in a small test scene.

- [x] **3.1 Texel sampling** (M) — nearest, bilinear, and bilinear with UVs snapped toward texel centres and a one-pixel antialiased edge sized from screen-space derivatives. Compared under perspective and motion at DPR 1, 1.5, 2 and 3, with and without mipmaps. Decides the default for every later effect. _Done: `texel-sampling`, three columns of one panning diorama, plus `experiments/texel-sampling-study.test.ts` against a 4×4 supersampled reference at DPR 1, 1.5, 2 and 3 (`experiments/texel-sampling-results.json`). Error against the reference, nearest / bilinear / sharp: 10.2 / 3.85 / 3.29 at DPR 1, 4.15 / 5.84 / 1.46 at DPR 3. Frame-to-frame popping: nearest about 3.7 at every DPR, sharp 0.92 to 1.20, bilinear calmest (0.78) but blurrier as DPR rises. **Default: sharp sampling, no mipmaps**; where art is minified, mipmaps with a −1 bias (`src/gpu/pixel/mips.ts`). Alpha stays at mip 0, because the batcher's cut-out reads level 0. DPR was emulated by canvas size, not checked on real high-DPR screens._
- [x] **3.2 Sprite batcher** (M) — instanced billboards from a texture-array atlas; camera-facing and vertical-axis-locked modes; pivot at the feet; depth write; alpha test against alpha-to-coverage; flipbook animation at its own rate (8 to 12 frames a second) while the scene runs at full rate; flip, tint and a hit-flash uniform. _Done: `src/gpu/sprites/` (batcher, diorama and orthographic light cameras, MSAA scene targets) and the `sprite-batch` scene. One instanced draw for every sprite and tile; upright, camera-facing and ground sprites; flipbooks on their own clock; flip, tint and hit flash; a pluggable WGSL shade chunk with its own bind group; `drawDepth` for shadow maps. Default cut-out: sharp sampling with 4× MSAA and alpha-to-coverage. Fixed during integration: the upright normal pointed away from the camera, normal maps were packed as sRGB, and shade code could not see facing or flip._
- [x] **3.3 Sprite lighting** (M) — flat, normal-mapped, and normals generated from the sprite's alpha via a jump-flood distance field treated as a rounded height map. Rim light. Light quantised into steps or remapped through palette ramps so shading stays in the artist's colours. _Done: `sprite-lighting`, flat, art-relief and automatic normals side by side under moving lights, with rim light and quantised or palette-snapped shading. Automatic normals come from an exact CPU Euclidean distance transform of the alpha (Felzenszwalb–Huttenlocher, about 1 ms a sprite) shaped as a quarter-circle bevel, checked against brute force; jump flooding was not needed at these sizes. **Default: automatic normals, radius 5, three light bands.** Relief from the art's lightness mostly adds noise, because dark outlines become grooves._
- [x] **3.4 Sprite shadows** (M) — blob shadow, a billboard turned toward the light in the shadow pass, crossed quads, and a silhouette projected on the ground. Judged from the default camera. _Done: `sprite-shadows`, blob, light-facing billboard, crossed quads and projected silhouette, into a `depth32float` map with 4×4 PCF via `textureSampleCompareLevel`. From the default camera **the billboard turned toward the light reads correctly at every sun angle and is the default**; the projected silhouette collapses to a line with the sun to the side, crossed quads double thin parts such as the spear, and blobs never show where the light is. Sprites do not receive shadows yet._
- [x] **3.5 Palette mapping** (S) — nearest palette colour in OKLab, through a 32³ lookup texture; ordered (Bayer) and blue-noise dither; palette ramps for shading. _Done: `palette-mapping` and `src/gpu/palette/` + `src/wgsl/palette.wgsl`. A 32³ lookup built on the CPU at start-up agrees with an exact OKLab search on 93.4% of 100,000 random colours, and where it differs its pick is at most 0.022 further away in OKLab; every output pixel is an exact palette colour. Bayer and blue-noise dither measure the same (local-average error 0.0138 → 0.0119 on the town) and only look different. **Defaults: Bayer, strength 0.12, pixel size 3; palette ramps for lit content.**_
- [x] **3.6 Palette cycling** [A] (S) — indexed-colour textures with cycling ranges, the 16-bit trick for water, lava, waterfalls and glowing runes, done in a shader. _Done: `palette-cycling`, the waterfall and lava converted to 8-bit indices at load with cycling ranges rotated in the shader. The flash analyser sees a cycling cell change every other step, so the rate is capped at 5 steps a second; an `uncapped (flashes)` preset is declared and labelled. The waterfall cycles by row so its bands travel down. Its foam cannot cycle, because it shares a colour with the lit rock._
- [x] **3.7 Outlines** (S) — one-pixel outlines from depth, normal and object-ID edges; a sprite outline from alpha for selection highlights. _Done: `outlines`, one-pixel lines from depth, normal and object-ID edges in a post pass over a second draw of the batch into a normal/ID buffer, and a selection outline from alpha that dims where the sprite is hidden. The selection outline is the most useful part; at full resolution a one-pixel line is thin against texels about four pixels wide, so it suits the low-resolution path. Multiple render targets would remove the second draw._
- [x] **3.8 Low-resolution render path** (M) — a fixed virtual resolution, a camera snapped to whole texels, the sub-texel remainder applied as an offset during upscaling, and a sharp upscale for non-integer scales. _Done: `low-res-path` and `src/gpu/pixel/lowres.ts`. The scene renders at a virtual resolution with the camera snapped to whole virtual pixels, and the snapped-off fraction returns as an offset in a sharp upscale. Orthographic, scale 3: no virtual pixel changes shape between frames (8.3% without snapping), and popping is 1.11 (5.37 without the offset, 1.53 for the full-resolution path). **Default: orthographic**, because perspective still reshapes about 2% of virtual pixels a frame. Palette adherence is 0.63 with the sharp upscale and 1.0 with nearest, which judders._
- [x] **3.9 Texel-snapped lighting** (M) — lighting and shadow evaluated at texel centres using derivatives of UV and world position, so light edges land on the pixel grid. Check UV seams. _Done: `texel-lighting`, a lantern's light and shadow evaluated at texel centres found by inverting the screen-space texel Jacobian, against per-pixel lighting. Of 103,907 pixel pairs inside one texel, per-pixel lighting splits 0.5% (four light steps) to 1.0% (eight); texel-snapped splits none. No seams at quad diagonals or tile joins; one pixel of mismatch by construction where the sharp filter blends two texels' colours but the light is taken from one._
- [x] **3.10 Bitmap text** (S) — a pixel font atlas, crisp at any integer scale, with a typewriter reveal. Used by damage numbers, title cards and dialogue. _Done: `bitmap-text` and `src/gpu/text/`, with "Wayfarer 5×7", an original proportional font designed for this repository (printable ASCII plus a few typographic marks), drawn with the frame, portrait and backdrop in one instanced draw, and a typewriter reveal that pauses after punctuation. It reads cleanly at ×3 to ×6. Under reduced motion a host should turn the typewriter off, or a page can freeze half-typed._

Epic 3 completion: ten stories, eleven gallery effects (with `hello`), each with presets, notes, a scorecard, a poster, inspector views or stages, and headless tests; 663 tests pass, and `browser-check` passes all 110 views. Built by three agents in parallel on the shared batcher, then integrated. Not measured: GPU time, because the agents shared one GPU and the study runs were inside the noise; every scorecard says so. Deferred to the stories that need them: multiple render targets for the outline buffer, a way for two shade chunks to share group 2, a length-based texel footprint (`fwidth` overestimates by up to √2), mip levels in the batcher so alpha can be mipmapped, and sprites receiving shadows.

## Epic 4 — The diorama

The scene kit. Kept small on purpose: everything here exists to stage effects.

- [x] **4.1 Scene format** (M) — a tile index image, a height image and `scene.json` for lights, sprites, props and camera. A scene a web developer could write by hand. Deterministic loading. _Done: `src/gpu/diorama/scene.ts` and `assets/scenes/village.json`. A legend maps each map character to the art on top, the art on the sides and a shape (block, stairs, slope); the map and the heights are rows of characters, north first, or images painted in any editor (hex-colour keys, height in the red channel), and both routes give the same scene (tested). `parseScene` names the row and column of a bad entry, finds which way stairs and slopes climb, and stands sprites on the ground with `heightAt`, which follows stairs and slopes. Sorted art names make sheet indices stable. Props are sprites for now; 4.4 adds the rest. The cleaner (`scripts/clean-art.mjs`) keeps hand-written `scene` entries in the manifest._
- [x] **4.2 Tile extruder** (M) — instanced blocks from the tile map, with top and side tiles, auto-tiled edges, stairs and slopes. One draw call for the terrain. _Done: `extrude.ts` lays the scene out as boxes on the CPU (testable without a GPU) and `terrain.ts`/`terrain.wgsl` draw every box in **one instanced draw** of 30 vertices; each side runs down only to the ground beside it, so hidden faces collapse (1,404 of the village's 1,608). Stairs are one box per quarter-unit tread; slopes tilt the top. Art is mapped by world position at 16 texels a unit, so terrain and sprites share a texel size. **Auto-tiled edges without edge art:** walls are mapped down from their top edge, so the cliff's grass fringe always sits on the lip; tops of different art at the same height are dithered together in whole texels over three; a one-texel rim lights ledges. `createDioramaStage` (`stage.ts`) is the reusable lit stage: terrain and sprites in one MSAA pass, a sun shadow map both cast into, hemisphere ambient and up to eight point lights. Shown in the `diorama` effect. The art holds still under motion at 1280 × 720 (popping 2.24 against a supersampled reference's 2.17, `experiments/diorama-stability.test.ts`); at 640 × 360 it pops twice as much. Tiles are still not seamless, which shows as a faint six-cell grid._
- [x] **4.3 Camera rig** (S) — the default narrow-angle camera; pan, dolly and pointer parallax; paths driven by scroll; orthographic as a comparison. _Done: `rig.ts`, DOM-free, so a page can drive it from anything: pan along the ground in the camera's terms, dolly in proportion, pointer parallax that rides on top of the target and springs back, and paths of poses (Catmull–Rom focus, eased angles) driven by time or by `scrollProgress` (the canvas's travel through the viewport). Everything eases toward a target. Orthographic frames the same height at the focus as perspective (tested). Shown in the `camera-rig` effect, where the wheel over the canvas stands in for scrolling because the gallery page does not scroll._
- [ ] **4.4 Props** (S) — trees as billboards and as crossed quads; low-poly pixel-textured houses with separate roofs; fences, signs, lanterns.
- [ ] **4.5 Sun and shadows** (M) — one directional light with a shadow map, PCF and a texel-snapped light frustum, starting from Light Temple's `shadow-map-pcf`. Proposed upstream to temple-core.
- [ ] **4.6 Point lights** (L) — torches, lanterns and windows: many small unshadowed lights plus shadows for the nearest few. Clustered culling only if the eight scenes need it.
- [ ] **4.7 Ambient and sky light** (S) — hemisphere ambient coloured by time of day.
- [ ] **4.8 Roof cut-away** [A] (S) — roofs and front walls dither out when the focus point is inside a building. A staple of the genre. Screen-door dither, so no sorting.
- [ ] **4.9 Foliage sway** [A] (S) — grass and tree sprites sheared by a wind field and pushed aside by moving characters.
- [ ] **4.10 Diorama water** (M) — planar reflection of tiles and sprites, ripple distortion in whole texels, a foam band from depth. Reuse Water Temple's optics where they fit.

M0's part of Epic 4 (4.1 to 4.3): the scene format, the tile extruder and a lit stage, the camera rig, and the `diorama` and `camera-rig` effects. The village is written by hand in `assets/scenes/village.json`. 1.16 ms at 1080p and 0.59 ms at 1266 × 585 on the M1 Max, the sun's shadows about a quarter of that ([docs/studies/epic-4.md](docs/studies/epic-4.md)). Built with two agents in parallel (5.1 and 9.4), then integrated: the lens was moved from its stand-in street onto the village, which needed the stage to make lamp glass glow (`"glow"` in a scene) and to switch MSAA live.

## Epic 5 — The lens

What makes the look recognisable. Most of it is post-processing over the HDR scene.

- [x] **5.1 Tilt-shift depth of field** (M) — circle of confusion from depth, a half-resolution gather blur, near and far fields handled separately, a focus band. Compared against a screen-space blur that grows with distance from a horizontal line and needs no depth. Decides the default and the Tier A fallback. _Done: `src/gpu/lens/tilt-shift.ts` (`createTiltShift`), shown on the village in `tilt-shift`. **depth** is a half-resolution gather after Jimenez (2014), ported from Moon Temple with its two fixes (a spread prefilter with jittered ring radii, so small lamps blur to discs rather than rings; and a far-field guess under the foreground, so a blurred near object is not an opaque slab): prefilter, spread, tiles, dilate, a 49-tap gather into separate near and far fields, composite. The circle of confusion is a focus band with separate near and far transitions; 4× depth is read with `textureLoad` (sample 0). **screen** blurs by distance from a horizontal line, half resolution, separable Gaussian. **Default: depth; Tier A fallback: screen.** On a deep street of sprites (`experiments/tilt-shift-study.test.ts`) the screen lens fitted to the ground matches it within 0.1 px, but 75% of upright blocks are off by more than 2 px, 69% of in-focus characters are blurred and 49% of blurred ones left sharp; it needs no depth (compatibility mode, flat layers, images) and costs much less. Cost on the M1 Max at 1080p: the depth lens adds about 0.6 to 0.8 ms (1.6 to 1.7 ms for the whole effect, noisy), the screen lens 0 to 0.3 ms ([docs/studies/epic-5.md](docs/studies/epic-5.md)). Finding: an upright sprite spans about 2.3 units of view depth at 35°, so a band thinner than a character blurs heads before feet; the default band is 4 units._
- [ ] **5.2 Bokeh highlights** (S) — bright out-of-focus lights as shaped discs: the glittering lanterns of a blurred background.
- [ ] **5.3 Rack focus** [B] (S) — animated focus distance, driven by time, scroll or a selected object.
- [ ] **5.4 Bloom for pixel scenes** (S) — Fire Temple's tail tuned so small emissive pixels glow without smearing the art around them.
- [ ] **5.5 Light shafts** (M) — screen-space radial blur of an occlusion mask against shadow-map ray marching. Forest canopies and windows.
- [ ] **5.6 Fog and distance haze** (S) — exponential height fog with sun in-scattering; atmospheric tint on distant layers.
- [ ] **5.7 Colour grading** (S) — 3D lookup tables, per area and per time of day, with crossfades.
- [ ] **5.8 Finishing** (S) — vignette, film grain and chromatic aberration at the edges, all subtle by default.
- [ ] **5.9 Exposure adaptation** (S) — the eye adjusting on entering a cave or stepping out of a dark interior.
- [ ] **5.10 Post order and cost** [—] (M) — the whole chain broken down per stage at 1080p and phone resolution; which stages each tier drops first; whether depth of field before bloom is the right order.

## Epic 6 — Field and ambient effects

What the world does while you explore it.

- [ ] **6.1 Torches, braziers and campfires** [A] (S) — Fire Temple flames as pixel sprites or palette-cycled tiles, each driving a flickering point light with temple-core's `flicker.wgsl`.
- [ ] **6.2 Fireflies and lanterns** [A] (S) — glowing particles that are also lights, in bounded numbers.
- [ ] **6.3 Dust motes** [A] (S) — particles visible only inside light shafts.
- [ ] **6.4 Falling leaves and petals** [A] (S) — pixel-sprite particles with flutter and wind.
- [ ] **6.5 Snowfall** [A] (S) — depth-layered flakes, breath fog on characters.
- [ ] **6.6 Snow accumulation** [B] (M) — snow building up on the tops of tiles and props, and footprints behind moving characters.
- [ ] **6.7 Rain and puddles** [B] (M) — streaks, ground splashes and ripple rings (Water Temple 10.1 and 10.2), darkened wet ground with specular, reflections in puddles.
- [ ] **6.8 Thunderstorm** [B] (M) — a bolt and a sky flash lighting the diorama, flash-safe by default (see the lightning section of [research.md](../research.md)). The bolt generator is shared with a future storm project.
- [ ] **6.9 Heat haze and sandstorm** [B] (M) — haze from temple-core's `haze.wgsl`; blowing sand and falling visibility.
- [ ] **6.10 Waterfall and river** [B] (M) — palette-cycled pixel water against scrolled textures; mist at the base.
- [ ] **6.11 Sea and shoreline** [B] (M) — glints quantised to texels, a foam line, waves breaking on tiles.
- [ ] **6.12 Cloud shadows** [A] (S) — soft shadows sweeping across the terrain.
- [ ] **6.13 Day and night** [B] (M) — sun angle, sky, grade, window lights turning on at dusk, lamps, stars.
- [ ] **6.14 Weather transitions** [B] (S) — blend between clear, rain, snow and fog over a few seconds.
- [ ] **6.15 Interaction cues** [A] (S) — a sparkle on a chest, a bobbing marker over a character, a glowing save point.

## Epic 7 — Battle effects

The effects toolkit. The first four stories are infrastructure; every effect after them is authored with it.

- [ ] **7.1 Particle system** (L) — compute-driven particles rendered either as texel-snapped pixel sprites or as soft HD sprites, chosen per emitter. Burst, cone, ring, line and surface emitters; size and colour over life; flipbooks; additive, alpha and premultiplied blending.
- [ ] **7.2 Timeline** (M) — one keyframed timeline for emitters, lights, sprite flashes, camera moves and screen effects, loaded from JSON so an effect is authored rather than coded. Scrubbable in the inspector with a fixed seed.
- [ ] **7.3 Ribbon trails** (M) — weapon arcs and swooshes from a path, with scrolling UVs and fade. Proposed upstream to temple-core, since lightning, beams and trails need it too.
- [ ] **7.4 Screen effects** (S) — hit-stop (held frames), shake, radial blur, flash to white with a capped luminance step, full-screen tint, desaturate everything but the subject. Reduced motion turns off shake, hit-stop and flashes.
- [ ] **7.5 Fire spell** [B] (M) — a fireball in flight, a burst, a scorch mark that glows and cools.
- [ ] **7.6 Ice spell** [B] (M) — crystal spikes from the ground, frost mist, shatter into shards.
- [ ] **7.7 Lightning spell** [B] (M) — a branching strike from above, ground sparks, a scene flash within the threshold.
- [ ] **7.8 Wind spell** [B] (M) — a swirl of streaks and leaves, slicing arcs.
- [ ] **7.9 Light spell** [B] (M) — a descending pillar, radial rays, hovering motes.
- [ ] **7.10 Dark spell** [B] (M) — tendrils, a desaturating pulse, shadow wisps.
- [ ] **7.11 Physical hits** [A] (S) — slash arcs, impact sparks, a white flash on the target sprite, a short knockback shake.
- [ ] **7.12 Damage numbers** [A] (S) — pixel numerals that pop and bounce, with a critical-hit variant.
- [ ] **7.13 Shield break** [B] (M) — a shield counter over a target; on break, shards fly, time slows briefly, the target staggers. The genre's signature beat.
- [ ] **7.14 Charge aura** [B] (M) — stacking levels of glow and rising particles around a character, released in a burst.
- [ ] **7.15 Special-move cut-in** [B] (M) — a diagonal banner with a portrait sliding in, speed lines, the field dimmed behind it.
- [ ] **7.16 Heal and buff** [A] (S) — rising sparkles, a warm glow, stat arrows.
- [ ] **7.17 Status effects** [A] (S) — small looping cues for poison, sleep, stun and burning.
- [ ] **7.18 Defeat dissolve** [A] (S) — the enemy flashes, fades toward white and breaks into pixels that drift upward.
- [ ] **7.19 Summon** [C] (L) — the field darkens, a silhouette appears, a burst of light, an oversized sprite with its own parallax.

## Epic 8 — Transitions and screen language

How scenes change. Several are direct descendants of 16-bit hardware tricks.

- [ ] **8.1 Battle-start transition** [B] (M) — the current frame is captured and breaks apart, spirals or zoom-blurs into the next scene.
- [ ] **8.2 Mosaic** [A] (S) — the classic pixel mosaic in and out.
- [ ] **8.3 Iris and shape wipes** [A] (S).
- [ ] **8.4 Fade with a time skip** [A] (S) — the inn: fade out, the grade moves from night to morning, fade in.
- [ ] **8.5 Area title card** [A] (S) — a place name drawn in over a darkened band.
- [ ] **8.6 Memory filter** [A] (S) — desaturated or sepia, soft vignette, blurred edges, grain: the flashback look.
- [ ] **8.7 Scanline wave** [A] (S) — per-row offsets for heat, underwater and dream sequences, after the 16-bit raster-effect technique.
- [ ] **8.8 Perspective floor plane** [A] (S) — a texture-mapped ground plane for world maps and flying, after the 16-bit "Mode 7" look.
- [ ] **8.9 Map unfurl** [B] (M) — a parchment map opens to an overworld view and a route draws itself across it.

## Epic 9 — Web-native motifs

Effects shaped like website components. The most directly applicable group.

- [ ] **9.1 Hero diorama** [B] (M) — a small scene behind a landing-page hero; scroll moves the camera and racks focus between sections.
- [ ] **9.2 Pointer-lit sprite** [A] (S) — a portrait or avatar sprite with a normal map, lit by the cursor.
- [ ] **9.3 Pixelate hover** [A] (S) — an image resolves between full detail and palette-mapped pixel art on hover.
- [x] **9.4 Pixel parallax header** [A] (S) — flat pixel layers at different depths with depth of field and light shafts. The cheapest route to the look, and the M0 effect. _Done: `parallax-header`. The five `assets/parallax/` layers as per-layer offsets in one fullscreen pass (planes facing a camera at one texel density reduce exactly to offsets), front to back with an early-out, sharp sampling, slow drift, eased pointer parallax and an optional scroll lag. **Depth of field the cheap way** (`src/gpu/lens/layer-dof.ts`): a flat layer has one circle of confusion, so each layer is blurred once into a texture (separable, premultiplied, texel-integrated Gaussian) and redrawn only when the focus or aperture changes: nothing per frame. **Light shafts** (`src/gpu/lens/shafts-screen.ts`): Mitchell's radial blur of a sun-and-sky occlusion mask at quarter resolution, two 12-tap passes. 0.6 ms at 1080p and at phone size on the M1 Max, at most 1.25 ms in any preset ([docs/studies/epic-9.md](docs/studies/epic-9.md)); popping 0.09 to 0.12 under the drift with sharp sampling against 0.24 to 0.26 with nearest; the art tiles without a visible seam. Over this art the shafts read as light spilling over the ridge more than as separate rays._
- [ ] **9.5 Dialogue box** [A] (M) — DOM text in a nine-slice pixel window with a typewriter reveal, a portrait and a bouncing next marker. The text stays in the DOM for screen readers and is shown whole under reduced motion.
- [ ] **9.6 Menu windows** [A] (S) — nine-slice pixel frames over a blurred, tinted copy of the canvas behind them; a pointing-hand cursor.
- [ ] **9.7 Day and night by the visitor's clock** [A] (S) — 6.13 driven by local time or `prefers-color-scheme`.
- [ ] **9.8 Notification banner** [A] (S) — the cut-in from 7.15 as an achievement or toast.
- [ ] **9.9 Empty state and 404 scene** [A] (S).
- [ ] **9.10 Route transitions** [A] (S) — mosaic and iris between pages, with the View Transitions API.
- [ ] **9.11 Button feedback** [A] (S) — hit sparks and a two-frame hit-stop on press.

## Epic 10 — Assets and authoring

So that people can use the effects with their own art, and so the project is not limited by its own.

- [ ] **10.1 Sprites baked from 3D** [—] (M) — render a glTF model from eight directions at low resolution, palette-map it and write a sprite sheet with normals, as Dead Cells' pipeline did.
- [ ] **10.2 Picture to pixel art** [—] (M) — downscale, palette (fixed, or k-means in compute), dither and outline; where it works and where it does not.
- [ ] **10.3 Normals for existing sprites** [—] (S) — 3.3's generator as an offline tool.
- [ ] **10.4 Tileset guide** [—] (S) — tile size, palette, auto-tile layout and what the extruder expects.
- [ ] **10.5 Scene editor** [—] (L) — stretch goal: paint tiles and heights in the browser, place lights and sprites, export the scene format.

## Epic 11 — Eight scenes

Eight dioramas that combine the effects above into complete pictures. Each is a showcase, a stress test, and a candidate hero for the holofx site. Each needs a reduced-motion still, a phone-sized version, and a poster.

- [ ] **11.1 Lantern town at dusk** [C] (L) — day and night, window lights, fireflies, roof cut-away.
- [ ] **11.2 Forest shrine** [C] (L) — light shafts, dust motes, falling leaves, deep focus.
- [ ] **11.3 Snowbound village** [C] (L) — snowfall, accumulation, breath, a cold grade, warm windows.
- [ ] **11.4 Desert ruins** [C] (L) — heat haze, a sandstorm rolling in, a palette-cycled oasis.
- [ ] **11.5 Seaside cliffs** [C] (L) — sea glints, shoreline, cloud shadows, birds.
- [ ] **11.6 Crystal cave** [C] (L) — bokeh, exposure adaptation, glowing crystals, a waterfall.
- [ ] **11.7 Stormy harbour** [C] (L) — rain, puddles, a thunderstorm, swaying lanterns.
- [ ] **11.8 Battle stage** [C] (L) — the Epic 7 kit on a battle backdrop: a party against enemies, a shield break, a charged special, a spell of each element.

## Epic 12 — Production readiness

Shorter than the temples' Epic 12 because the library entry exists from story 1.3.

- [ ] **12.1 Embed check** (S) — every effect mounts through `src/lib` and HoloGPU's `createEffect` in CI; per-effect gzip size and asset bytes reported.
- [ ] **12.2 Assets on the library path** (M) — atlases, palettes and scene files passed as URLs the caller controls; nothing depends on `new URL(..., import.meta.url)` (holofx backlog 4.3).
- [ ] **12.3 Adaptive quality** (M) — fall back to screen-space depth of field, cheaper shafts, fewer shadowed lights, a lower virtual resolution, in that order.
- [ ] **12.4 Accessibility** (M) — the flash analyser over every preset and every timeline; reduced motion as defined in the definition of done; dialogue text readable by assistive technology.
- [ ] **12.5 Fallback ladder** (S) — poster or looped video per scene; CSS-only versions of the dialogue box, menu windows and notification banner.
- [ ] **12.6 Catalogue output** (S) — emit the holofx `catalogue.json` with status tags (holofx backlog 3.9, 3.10).
- [ ] **12.7 Layering recipes** (S) — a transparent canvas over the page, DOM interface above the canvas, pointer passthrough.

## Epic 13 — Benchmarking and findings

Turn the demos into conclusions.

- [ ] **13.1 Cost studies** (M) — one per effect epic from the study harness, collected into one results page.
- [ ] **13.2 Device matrix** (M) — an integrated-GPU laptop, Apple Silicon, a mid-range Android phone and an iPhone. Scheduled in M3.
- [ ] **13.3 HD path against low-resolution path** [—] (M) — the same scene both ways: cost, look, stability under motion.
- [ ] **13.4 Live against baked** [—] (M) — battle effects as sprite-sheet flipbooks against live particles: bytes, GPU cost, what is lost.
- [ ] **13.5 Decision guide** (M) — which effect for which job, with budgets and caveats.
- [ ] **13.6 Visual regression** (M) — screenshot tests with a fixed seed; pixel-exact on the low-resolution path.
- [ ] **13.7 Bibliography** (S) — every reference, linked from the effects that use it.

---

## Risks and open questions

- **Art.** The look depends on good pixel art more than on any shader, and story 1.6 is on the critical path. The art is a small AI-generated test set ([art.md](art.md)), so consistency between images matters little. The risk sits in two places: the cleanup needed to turn AI output into real pixel art for the experiments that depend on an exact grid, and provenance. Copyright in purely AI-generated images is uncertain in some countries, and an output can resemble a known character by accident.
- **Intellectual property.** Recreating the effects of a commercial game is fine; recreating its assets, interface or characters is not. Notes link to reference footage; nothing from a game is committed. Effect names stay generic.
- **Pixel stability.** Smooth camera motion over pixel art shimmers unless sampling (3.1) and snapping (3.8) are right. If it cannot be made stable at a non-integer DPR, the HD path needs a documented minimum.
- **Depth-of-field cost.** It is the signature of the look and the most expensive stage. If the gather version does not fit Tier B on an integrated GPU, the screen-space version becomes the default for Tiers A and B and the notes say so.
- **Transparency and sorting.** Sprites, particles, water and fog all blend. Alpha-to-coverage needs MSAA, and MSAA on `rgba16float` targets has a cost that has not been measured in any temple.
- **Photosensitivity.** Battle effects are built from flashes. The capped flash in 7.4 and the analyser over every timeline are requirements, not polish.
- **Scope creep toward an engine.** A scene format, lights, a timeline and an editor are the start of a game engine. Hold the line in the non-goals; the scene kit exists to stage effects.
- **Shared core coupling.** temple-core is at 0.1.x. Changes this project needs (shadow maps, MSAA targets, ribbons) go upstream through hologpu's release process, which will slow some stories. That is the price of not having a third copy.
- **Light Temple overlap.** Light Temple has its own engine with shadow maps, image-based lighting and temporal antialiasing that temple-core does not include. Porting pieces here risks a fourth copy; moving them into temple-core is the better route and needs Light Temple's agreement on the contract (holofx backlog 3.7).
- **Measurement.** The caveats carried over from the temples apply. Only an M1 Max has been measured so far in any temple.
- **Scope.** There are 126 stories. M0 to M2 make a complete, useful site; M3 to M5 can be trimmed without leaving holes.

## Starting references

Recalled, not yet checked; confirm each before citing it in a write-up.

- Acquire and Square Enix, _The Fusion of Nostalgia and Novelty in the Development of Octopath Traveler_ (Unreal Fest Europe 2019).
- t3ssel8r's videos on 3D pixel-art rendering — texel-snapped lighting and the snapped camera.
- Thomas Vasseur, _Art Design Deep Dive: Using a 3D Pipeline for 2D Animation in Dead Cells_ (2018).
- Jorge Jimenez, _Next Generation Post Processing in Call of Duty: Advanced Warfare_ (SIGGRAPH 2014) — gather depth of field.
- Kenny Mitchell, _Volumetric Light Scattering as a Post-Process_ (GPU Gems 3, ch. 13).
- Sébastien Hillaire, _Physically Based and Unified Volumetric Rendering in Frostbite_ (SIGGRAPH 2015).
- Joseph Huckaby, _Old School Color Cycling with HTML5_ (2010), after Mark Ferrari's palette-cycled scenes.
- Björn Ottosson, _A Perceptual Color Space for Image Processing_ (2020) — OKLab.
- Bryce Bayer, _An Optimum Method for Two-Level Rendition of Continuous-Tone Pictures_ (1973); Christoph Peters, _Free Blue Noise Textures_ (2016).
- Rong and Tan, _Jump Flooding in GPU with Applications to Voronoi Diagram and Distance Transform_ (2006).
- William Reeves, _Particle Systems — A Technique for Modeling a Class of Fuzzy Objects_ (1983).
- Jan Willem Nijman, _The Art of Screenshake_ (2013); Steve Swink, _Game Feel_ (2008) — hit-stop and shake.
- WebGPU and WGSL specifications; webgpufundamentals.org.
