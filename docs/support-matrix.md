# WebGPU support matrix delta (Eightfold Path story 1.8)

**Checked 2026-10-14.** This is a delta on Fire Temple's [support matrix](../../firetemple/docs/support-matrix.md) (re-checked 2026-10-13), which stays the baseline for everything it covers. This file adds what Eightfold Path leans on and Fire Temple does not: MSAA with `rgba16float`, alpha-to-coverage, texture arrays, depth formats and comparison samplers. It re-reads `float32-filterable` and `timestamp-query` from this project's point of view.

How this check was done

- **Spec.** The WebGPU Editor's Draft source ([`spec/index.bs`](https://github.com/gpuweb/gpuweb/blob/main/spec/index.bs), last changed 2026-09-23) and WGSL source ([`wgsl/index.bs`](https://github.com/gpuweb/gpuweb/blob/main/wgsl/index.bs), last changed 2026-09-15) were read directly. Every rule quoted below was also found in the W3C [Candidate Recommendation Draft of 2026-09-15](https://www.w3.org/TR/webgpu/). "Core" means guaranteed on a device from a default `requestAdapter()` with no `requiredFeatures` and no `requiredLimits`. "Compat" means a device from `featureLevel: 'compatibility'` without `core-features-and-limits`.
- **Field data.** web3dsurvey pages re-read 2026-10-14 (percent of reports, not of users; no date stamp or sample size on the site). MDN BCD read from [`main`](https://github.com/mdn/browser-compat-data/tree/main/api) (last commit to `GPUSupportedFeatures.json` 2026-10-13). Release notes: [Chrome "What's New in WebGPU" index](https://developer.chrome.com/docs/web-platform/webgpu/news), WebKit's [Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/), [26.2](https://webkit.org/blog/17640/webkit-features-for-safari-26-2/) and [27.0](https://webkit.org/blog/18325/webkit-features-for-safari-27-0/) posts, and [Technology Preview 253](https://webkit.org/blog/18357/release-notes-for-safari-technology-preview-253/) and [254](https://webkit.org/blog/18420/release-notes-for-safari-technology-preview-254/).
- **No browser was run** in this check. The four core features in this delta (MSAA, alpha-to-coverage, texture arrays, comparison samplers) have **no per-feature BCD entries and no survey pages**: BCD only versions the API objects (`createRenderPipeline`, `createSampler`, the limits), with the same versions as WebGPU itself. So "works in browser X" below means "browser X ships WebGPU on that platform (Fire Temple section 1), and the spec makes this core". That is inference from the spec, not observed behaviour. It is listed again under "Not confirmed".

## 0. Already covered by Fire Temple's matrix

Not repeated here. Read them there:

- Which browser has WebGPU on which OS and GPU, and share of users: [section 1](../../firetemple/docs/support-matrix.md#1-browser-and-platform-support).
- `rgba16float` as a render target, blendable and filterable in core; HDR canvas output: [0.1](../../firetemple/docs/support-matrix.md#01-summary), [0.3](../../firetemple/docs/support-matrix.md#03-hdr-output-rgba16float-canvas-with-tonemapping--mode-extended-).
- Every optional feature by browser, with survey shares, including the `float32-filterable` and `timestamp-query` rows: [section 2](../../firetemple/docs/support-matrix.md#2-optional-features).
- Limits that bite on mobile, including `maxColorAttachmentBytesPerSample` field values: [section 3](../../firetemple/docs/support-matrix.md#3-limits-that-bite-on-mobile).
- Compatibility mode and its restrictions: [5.1](../../firetemple/docs/support-matrix.md#51-compatibility-mode-requestadapter-featurelevel-compatibility-).

## 1. Summary

| What Eightfold Path uses | Core or optional | Limits that matter (core default) | Compat | When it is missing |
|---|---|---|---|---|
| 4x MSAA on an `rgba16float` scene target, resolved | **Core.** `sampleCount` must be 1 or 4 | `maxColorAttachmentBytesPerSample` 32 B; `rgba16float` costs 8 B | **Not allowed**: `rgba16float` multisampling and resolve need `core-features-and-limits` | Cannot be missing on a core device. In compat, no MSAA on the HDR target |
| Alpha-to-coverage for sprite cutouts | **Core** (`alphaToCoverageEnabled`) | Needs `count` > 1, so MSAA | Only on an 8-bit target (see 3) | Alpha test (`discard`) at sample count 1 |
| Texture arrays (sprite and tile atlas pages, shadow-map arrays) | **Core** (`2d-array` views, `texture_2d_array`, `texture_depth_2d_array`) | `maxTextureArrayLayers` 256; `maxSampledTexturesPerShaderStage` 16; `maxSamplersPerShaderStage` 16 | Allowed; cube-array views are not | Cannot be missing |
| `depth32float` / `depth24plus` scene and shadow depth, sampled with a comparison sampler (hardware PCF) | **Core.** `depth32float-stencil8` alone is **optional** | none specific | Depth may only be sampled with a comparison sampler, and `textureLoad` on depth is not allowed | Cannot be missing |
| `float32-filterable` | **Optional** | none | same | Nothing in the plan needs it (see 6) |
| `timestamp-query` | **Optional** | none | same | rAF frame time in the HUD; per-pass numbers from the Dawn study harness |

## 2. MSAA with `rgba16float`

What the spec guarantees ([plain color formats table](https://gpuweb.github.io/gpuweb/#plain-color-formats), [texture creation](https://gpuweb.github.io/gpuweb/#dom-gpudevice-createtexture)):

- `sampleCount` must be **1 or 4**. There is no 2x or 8x in WebGPU.
- `rgba16float` is renderable and blendable in core. Its **multisampling and resolve** columns read "If `core-features-and-limits` is enabled". A default adapter always has that feature ([definition](https://gpuweb.github.io/gpuweb/#core-features-and-limits)), so 4x `rgba16float` with a resolve target is core. In compat it is invalid.
- A multisampled texture must have 1 mip level and 1 array layer, must include `RENDER_ATTACHMENT`, and must not include `STORAGE_BINDING`. So multisampled targets are never arrays and cannot be written from compute.
- For contrast: `rg11b10ufloat` needs `rg11b10ufloat-renderable` to multisample (Fire Temple 0.1). `r32float` multisamples with `core-features-and-limits` but can never be resolved. `rgba32float` can neither multisample nor resolve.

**`maxColorAttachmentBytesPerSample`.** The default is **32** in core and compat ([limits](https://gpuweb.github.io/gpuweb/#limits)). It counts bytes for **one sample** across all colour attachments ([algorithm](https://gpuweb.github.io/gpuweb/#abstract-opdef-calculating-color-attachment-bytes-per-sample)), so going from 1x to 4x does not change the count. Per-format costs from the table: `rgba16float` 8, `rgba8unorm` 8 (not 4), `rgb10a2unorm` 8, `r32float` 4, `rgba32float` 16. The running total is first rounded up to each format's component alignment (2 B for 16-bit formats, 4 B for 32-bit ones). An HDR target plus up to three more 8-byte targets (for example normals or object IDs for 3.7's outlines) fits 32 B without requesting a limit. Field values: 32 on 100% of reports, 64 on 98%, 128 on 82%. Safari and iOS stop at 64; Samsung Internet shows only 32 ([survey](https://web3dsurvey.com/webgpu/limits/maxColorAttachmentBytesPerSample), the same as Fire Temple's 2026-10-13 read).

**Depth with MSAA.** Every depth format supports multisampling ([depth-stencil formats](https://gpuweb.github.io/gpuweb/#depth-formats)). **WebGPU has no depth resolve**: [`GPURenderPassDepthStencilAttachment`](https://gpuweb.github.io/gpuweb/#dictdef-gpurenderpassdepthstencilattachment) has no `resolveTarget`. A later pass that needs depth (depth of field, fog, outlines) reads the multisampled depth with `textureLoad` on `texture_depth_multisampled_2d`, or reads a depth value the main pass also wrote to a colour target.

**Memory** (my arithmetic). 4x `rgba16float` + 4x `depth32float` + a 1x resolve target is 110.7 MiB at 1920x1080 and 158.2 MiB at 1170x2532 (an iPhone-sized screen at DPR 3). Of that, the multisampled colour alone is 63.3 MiB and 90.4 MiB.

**Per browser.** Nothing found in written sources beyond what the spec implies. One relevant fix: Safari 26.2 and 27.0 fixed passing a bare `GPUTexture` (not a view) as a depth-stencil attachment and as a multisampled resolve target ([26.2](https://webkit.org/blog/17640/webkit-features-for-safari-26-2/), [27.0](https://webkit.org/blog/18325/webkit-features-for-safari-27-0/)). The cost of 4x MSAA on `rgba16float` is not measured in any temple ([plan risks](../plan.md#risks-and-open-questions)).

## 3. Alpha-to-coverage

What the spec guarantees ([`GPUMultisampleState`](https://gpuweb.github.io/gpuweb/#dom-gpumultisamplestate-alphatocoverageenabled), [validating `GPUMultisampleState`](https://gpuweb.github.io/gpuweb/#abstract-opdef-validating-gpumultisamplestate), [render pipeline validation](https://gpuweb.github.io/gpuweb/#abstract-opdef-validating-gpurenderpipelinedescriptor), [alpha to coverage](https://gpuweb.github.io/gpuweb/#alpha-to-coverage)):

- **Core, with no feature flag.** `multisample: { count: 4, alphaToCoverageEnabled: true }`.
- `count` must be greater than 1. Alpha-to-coverage does not exist without MSAA.
- `targets[0]` must exist and be **blendable and have an alpha channel**. `rgba16float` qualifies; `rg11b10ufloat` does not. The alpha used is the one written to `@location(0)`.
- It cannot be combined with a shader that outputs the `sample_mask` builtin.
- The mask is **platform-dependent**. Alpha at or below 0 covers no samples; alpha at or above 1 covers all. Values in between "should" cover a proportionate number of samples, and the spec says the count may not rise monotonically with alpha for a given pixel. At 4 samples there are at most 5 coverage levels (my arithmetic).
- **Compat:** `rgba16float` cannot be multisampled, so alpha-to-coverage there needs an 8-bit target such as `rgba8unorm`, which multisamples unconditionally. Compat also forbids `sample_mask` and `sample_index` in fragment shaders (Fire Temple 5.1).

**Per browser.** No source mentions alpha-to-coverage: there is no BCD sub-entry, nothing in the Chrome WebGPU news index, and nothing in the WebKit 26.0, 26.2, 27.0 or Technology Preview 253-254 notes. A related Safari item: Technology Preview 254 fixed `copyExternalImageToTexture()` passing lossy premultiplied data instead of preserving alpha ([STP 254](https://webkit.org/blog/18420/release-notes-for-safari-technology-preview-254/)). That matters for sprite atlases uploaded from images; whether Safari 27 release has the bug is not confirmed.

## 4. Texture arrays

What the spec guarantees:

- `2d-array` views, `texture_2d_array<f32>` and `texture_depth_2d_array` are core. Sampling builtins take an `array_index` of `i32` or `u32` ([WGSL `textureSampleCompare`](https://gpuweb.github.io/gpuweb/wgsl/#texturesamplecompare) shows the array overloads). All layers share one size, format and mip count, and are bounded by `maxTextureDimension2D` (8192 core, 4096 compat).
- [`maxTextureArrayLayers`](https://gpuweb.github.io/gpuweb/#dom-supported-limits-maxtexturearraylayers): **256** in core and compat. Chrome 126 allows requesting up to 2048 ([Chrome 126](https://developer.chrome.com/blog/new-in-webgpu-126#increase_maxtexturearraylayers_limit)). Survey: 256 on 100%, 2048 on 99% overall; Arm Bifrost shows 1024 on 94% and no 2048 row ([survey](https://web3dsurvey.com/webgpu/limits/maxTextureArrayLayers)).
- [`maxSampledTexturesPerShaderStage`](https://gpuweb.github.io/gpuweb/#dom-supported-limits-maxsampledtexturespershaderstage): **16** in core and compat. An array texture is one binding, however many layers it has. Chrome 146 can grant up to 48 on request (Fire Temple section 3). Survey: 16 on 100%, 44+ on 91%, 48+ on 77%. Samsung Internet shows only 16 (it is Chromium 143), ChromeOS has 48 on 18%, Safari and iOS have 44 on 99% ([survey](https://web3dsurvey.com/webgpu/limits/maxSampledTexturesPerShaderStage)).
- `maxSamplersPerShaderStage`: **16** in core and compat; 16 on 100% of reports, and Chrome rarely reports more ([survey](https://web3dsurvey.com/webgpu/limits/maxSamplersPerShaderStage)).
- Cube and cube-array views (point-light shadows) are core. **Compat forbids cube-array views**, fixes each texture to one view dimension, and requires a bound view to cover all layers (Fire Temple 5.1; [texture creation](https://gpuweb.github.io/gpuweb/#dom-gpudevice-createtexture)).

**Per browser.** Every browser that ships WebGPU exposes the limits from its first release (BCD, same versions as `GPUSupportedLimits` itself). Array sampling behaviour was not tested.

## 5. Depth formats and comparison samplers

What the spec guarantees ([depth-stencil formats](https://gpuweb.github.io/gpuweb/#depth-formats)):

| Format | Core? | Sample types | Copy source / destination | Notes |
|---|---|---|---|---|
| `depth16unorm` | core | `depth`, `unfilterable-float` | yes / yes | |
| `depth24plus`, `depth24plus-stencil8` | core | `depth`, `unfilterable-float` | **no / no** (depth aspect) | Opaque: may be 24-bit or 32-bit float |
| `depth32float` | core | `depth`, `unfilterable-float` | yes / **no** | |
| `depth32float-stencil8` | **optional** (`depth32float-stencil8`) | as above | yes / no | Survey 99.99% ([page](https://web3dsurvey.com/webgpu/features/depth32float-stencil8)); BCD Chrome 113, Safari 26, Firefox "no" (Fire Temple says Firefox implements it in source) |

- All depth formats support `TEXTURE_BINDING`, `RENDER_ATTACHMENT` and multisampling. None can be 3D.
- No depth format has sample type `float`, so **depth cannot be read through a `filtering` sampler**. But the spec says depth "can always be used with `comparison` samplers even if they use filtering". So `createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' })` on a `depth32float` shadow map gives hardware 2x2 PCF in core, with no feature and no `float32-filterable`. Chrome 132 warns on depth with a non-comparison filtering sampler and says it will be disallowed ([Chrome 132](https://developer.chrome.com/blog/new-in-webgpu-132#filtering_sampler_restrictions_on_textures)).
- WGSL ([`textureSampleCompare`](https://gpuweb.github.io/gpuweb/wgsl/#texturesamplecompare), [`textureSampleCompareLevel`](https://gpuweb.github.io/gpuweb/wgsl/#texturesamplecomparelevel)): `textureSampleCompare` is **fragment-only** and must be in uniform control flow, because it takes derivatives. `textureSampleCompareLevel` samples mip 0, works in any stage, and is not a derivative builtin, so it is the one to use inside per-light loops. Both have `texture_depth_2d_array` overloads; `textureGatherCompare` also exists.
- Reading raw depth for depth of field: in core, `textureLoad` on `texture_depth_2d` or `texture_depth_multisampled_2d`. Bound as `texture_2d<f32>`, depth reads as `(D, X, X, X)` with the other channels unspecified unless the optional `texture-component-swizzle` feature is on ([reading depth](https://gpuweb.github.io/gpuweb/#reading-depth-stencil); BCD: Chrome 143, Firefox and Safari no). The `texture_depth_*` types avoid the question.
- **Compat** ([shader validation](https://gpuweb.github.io/gpuweb/#abstract-opdef-validating-gpuprogrammablestage)): `textureLoad` on a depth texture is not allowed, and a depth texture used with a sampler must use a `sampler_comparison`. So a compat depth-of-field cannot read the depth buffer at all; the main pass must also write depth to a colour target. Compat also requires `depthBiasClamp` to be 0 (Fire Temple 5.1).

## 6. `float32-filterable` (re-read)

Optional ([definition](https://gpuweb.github.io/gpuweb/#float32-filterable)): it makes `r32float`, `rg32float` and `rgba32float` filterable, and nothing else. Field data re-read 2026-10-14 is unchanged from Fire Temple's 2026-10-13 read: 91.11% overall, Android 70.47%, iOS 54.9%, Safari 57.37%, Adreno 6xx 9.98%, Adreno 7xx 47.39% ([survey](https://web3dsurvey.com/webgpu/features/float32-filterable)). BCD is also unchanged (Chrome 119, Android 121; Firefox and Safari "no", which conflicts with the survey; see Fire Temple 2.1).

What this project would use it for: nothing in Epics 3 to 5 needs it. The HDR chain is `rgba16float`, which filters in core. Shadow PCF uses comparison sampling (section 5). The only way to need it by accident is a linearly filtered `r32float` (for example linear depth for fog or depth of field). Use `textureLoad`, or store that value in `r16float` / `rgba16float` (filterable and renderable in core).

## 7. `timestamp-query` (re-read)

- Optional ([feature](https://gpuweb.github.io/gpuweb/#dom-gpufeaturename-timestamp-query)). Values are implementation-defined; the counter may reset, giving negative deltas that "can safely be discarded" ([timestamp query](https://gpuweb.github.io/gpuweb/#timestamp)).
- **New relative to Fire Temple: coarsening is now a spec rule, not a Chrome choice.** The queue timestamp is the result of HR-Time's [coarsen time](https://w3c.github.io/hr-time/#dfn-coarsen-time) with `crossOriginIsolatedCapability` set to **false**. That means a resolution of 100 microseconds "or a higher implementation-defined value", and cross-origin isolation can never improve it. The text is in both the Editor's Draft and the 2026-09-15 CRD. Chrome has quantized to 100 µs since 120; its "WebGPU Developer Features" flag turns this off ([Chrome 120](https://developer.chrome.com/blog/new-in-webgpu-120#timestamp_queries_quantization)).
- Availability (re-read 2026-10-14, unchanged from 2026-10-13): 98.77% overall; Safari 93.13%, macOS 96.05%, Android 97.52%; Intel Gen-8 only 61.13% ([survey](https://web3dsurvey.com/webgpu/features/timestamp-query)). BCD: Chrome 121, Safari 26, Firefox "no" (conflicts with source and survey; Fire Temple 2.1).

## 8. What this means for Eightfold Path

1. **Device.** The scene path (Epics 3 to 5) needs a core device: MSAA `rgba16float`, raw depth reads and cube-array shadows are all core-only. Request no optional features for M0. Tier A effects meant to run in compat (for example 9.4) use no MSAA on the HDR target, alpha test instead of alpha-to-coverage, and depth written to a colour target.
2. **`rgba16float` at 4x MSAA is safe in core** on every browser and adapter that has WebGPU, by the spec. Use `sampleCount: 4` or 1, never 2 or 8. Keep each pass's colour attachments at 32 B per sample or less without requesting limits; `rgba16float` uses 8. The cost is unmeasured: measure it in 3.2 and 5.10 against the memory figures in section 2, and let 12.3 drop to 1x first.
3. **Alpha-to-coverage is the sprite-cutout default on the MSAA path**, with alpha written at `@location(0)` into the `rgba16float` target. At sample count 1 (the low-resolution path 3.8, compat, or adaptive quality) use alpha test with `discard`. Never output `sample_mask` in the same pipeline. The mask pattern differs by platform, so check it with the texel loupe (2.4) on more than one GPU.
4. **Depth: `depth32float`** for the scene and for shadow maps. It is core, filterable through a comparison sampler (hardware PCF with `compare` plus linear filters, no feature), and copyable as a source; `depth24plus` cannot be copied at all. Avoid `depth32float-stencil8`: nothing needs stencil, and it is the only optional depth format. Sample shadows with `textureSampleCompareLevel` inside light loops. Put sun cascades and spot shadows in one `texture_depth_2d_array`. Point-light cube arrays are core but not compat.
5. **Depth of field reads depth with `textureLoad`.** There is no depth resolve, so the circle-of-confusion pass loads sample 0 from `texture_depth_multisampled_2d` (core only). The compat fallback is the screen-space version from 5.1, which needs no depth.
6. **Texture arrays: stay within 256 layers and 16 sampled textures per stage** without requesting limits. Samsung Internet is fixed at 16, and Bifrost often lacks 2048 layers. Count atlas pages, shadow arrays, colour-grading lookup tables, noise and palette textures against the 16. Requesting more is a per-effect, recorded decision (Fire Temple implication 1).
7. **Do not rely on `float32-filterable`.** Nothing needs it; never linearly filter an `r32float`.
8. **`timestamp-query` is HUD-only.** Request it only if `adapter.features` has it. Expect 100 µs or coarser everywhere, so time groups of passes rather than single cheap passes, average over 60 or more frames, discard negative deltas, and label the numbers approximate. When it is missing, show rAF frame time and say so; per-pass costs come from the Dawn study harness (plan, "Carried over").
9. **Plumbing.** Always pass `GPUTextureView`s for resolve and depth attachments (the Safari fixes in section 2). Do not let sprite edges depend on the RGB of fully transparent texels, because of the Safari upload bug in section 3. Story 1.5 already rejects partial alpha.

## 9. Not confirmed

- **Per-browser behaviour of the four core features** (4x `rgba16float` MSAA and resolve, alpha-to-coverage, array sampling, linear-filtered comparison sampling): taken from the spec. BCD has no sub-entries, the survey does not record core features, and no browser was run. webgpureport.org reports only the visiting machine's adapter, so it was not used.
- **The alpha-to-coverage mask on each platform** (sample pattern, monotonicity). The spec leaves it platform-dependent; no written per-browser source exists; it needs a device test.
- **The cost of 4x MSAA on `rgba16float`** on any device. Not measured in any temple.
- **Whether Safari and Firefox coarsen timestamps to 100 µs** as the spec requires. Chrome documents it. A search of Firefox source (Searchfox: "quantiz" and "coarsen" in `dom/webgpu` and `gfx/wgpu_bindings`, "timestamp_quantization" in the whole tree) and WebKit source (GitHub code search) found no coarsening code. That is absence of evidence only; not tested.
- **Whether Safari 27 release has the `copyExternalImageToTexture` premultiplied-alpha bug** fixed in Technology Preview 254.
- **Whether Chrome 132's warning** for depth with a filtering sampler has since become an error. No later Chrome post found that says so.
- Survey sample sizes are unpublished, as noted in Fire Temple. The Samsung Internet column is the least stable.
