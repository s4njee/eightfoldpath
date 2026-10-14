# Eightfold Path — test art

Eightfold Path is a set of WebGPU experiments, not a game. Its art exists to give each experiment something to work on, so this is the smallest set that covers the plan's experiments. The prompts to generate it are in [prompts.md](prompts.md).

## What test art needs

- **One subject per image**, on a flat magenta background, so it can be cut out.
- **No baked lighting.** No shadows, glows, blur or dusk colouring painted in. The effects add those, and baked lighting hides what an effect is doing.
- **Chunky pixels with a visible grid.** A clear grid can be recovered by downsampling; a soft one cannot.
- **Consistency between images matters little.** These images do not have to match each other in style or size.

Only three groups of experiments need a real pixel grid and palette: texel sampling (3.1), palette mapping and cycling (3.5, 3.6), and the low-resolution path (3.8). For those, clean the image up first: downsample to its grid, map it to a palette, and make alpha exactly 0 or 255. Everything else can use an image as soon as the background is keyed out.

## Already have

Four Meshy renders of a dusk town, in `art/dusktown/`. Move them to `art/reference/`. They are target frames to compare the lens against (Epic 5, scene 11.1), and inputs for the palette-mapping and picture-to-pixel experiments (3.5, 10.2). They are not cut-out assets.

## The set

35 items: 32 images and 3 3D models. The first batch, 16 items, covers every experiment up to milestone M1.

| # | File | What | Tests | Batch |
|---|---|---|---|---|
| 1 | `characters/traveller.png` | Cloaked sword fighter | Sprites, sprite lighting and shadows (3.2–3.4), battle effects | First |
| 2 | `characters/slime.png` | Green slime | Sprite lighting on a round shape, battle effects (Epic 7) | First |
| 3 | `characters/mage.png` | Robed spellcaster | Sprite batching with several characters | Later |
| 4 | `characters/knight.png` | Armoured knight with shield | Sprite shadows on a bulky shape | Later |
| 5 | `characters/slime-bounce.png` | Four-frame slime bounce sheet | Flipbook animation (3.2); best effort | Later |
| 6 | `props/lantern.png` | Street lantern, glass in flat yellow | Bloom, point lights, glow masks (4.6, 5.4) | First |
| 7 | `props/barrel.png` | Wooden barrel | Automatic normals (3.3) | First |
| 8 | `props/tree.png` | Broadleaf tree | Foliage sway (4.9), light shafts through leaves | First |
| 9 | `props/crystals.png` | Glowing crystal cluster | Bloom and bokeh (5.2) | Later |
| 10 | `props/chest.png` | Treasure chest | Interaction sparkle (6.15) | Later |
| 11 | `props/boulder.png` | Mossy boulder | Automatic normals on an irregular shape | Later |
| 12 | `tiles/cobblestone.png` | Seamless cobblestone | Texel sampling (3.1), diorama ground (4.2) | First |
| 13 | `tiles/grass.png` | Seamless grass | Diorama ground, foliage | First |
| 14 | `tiles/dirt-path.png` | Seamless dirt path | Diorama ground | Later |
| 15 | `tiles/sand.png` | Seamless rippled sand | Heat haze (6.9) | Later |
| 16 | `walls/house-front.png` | Timber-frame house front, windows in flat yellow | Diorama walls, roof cut-away (4.8), day and night (6.13) | First |
| 17 | `walls/stone-wall.png` | Stone wall | Diorama walls | Later |
| 18 | `walls/cliff.png` | Earth cliff face | Raised terrain sides (4.2) | Later |
| 19 | `walls/roof.png` | Shingle roof from above | Diorama roofs, roof cut-away | Later |
| 20 | `cycling/waterfall.png` | Waterfall in five banded blues | Palette cycling (3.6) | First |
| 21 | `cycling/lava.png` | Lava in five banded oranges | Palette cycling | Later |
| 22–26 | `parallax/sky.png`, `mountains.png`, `hills.png`, `treeline.png`, `foreground.png` | Five landscape layers | Parallax header (9.4), depth of field (5.1) | First |
| 27 | `illustrations/town.png` | Painted dusk town, not pixel art | Pixelate hover (9.3), picture to pixel art (10.2) | First |
| 28 | `illustrations/forest.png` | Painted forest | As above | Later |
| 29 | `illustrations/harbour.png` | Painted harbour | As above | Later |
| 30 | `vfx/magic-circle.png` | White line-art magic circle on black | Additive and emissive effects (Epic 7) | Later |
| 31 | `ui/window-frame.png` | Parchment window with a wooden border | Dialogue box and menu windows (9.5, 9.6) | Later |
| 32 | `ui/traveller-bust.png` | Portrait bust of the traveller | Pointer-lit sprite (9.2), dialogue portrait | Later |
| 33 | `models/town-square.glb` | Town square diorama, unlit textures | The lens: depth of field, bloom, shafts, fog, shadows (Epic 5) | First |
| 34 | `models/forest-clearing.glb` | Forest clearing with a shrine | Light shafts, dust motes (5.5, 6.3) | Later |
| 35 | `models/traveller.glb` | Traveller as a 3D character | Sprites baked from 3D (10.1) | Later |

## Where files go

Raw generator output goes in `art/<group>/` under the names above. Cleaned versions go in `assets/` once the repo is scaffolded (story 1.5), with an entry in `assets/manifest.json`.

## Provenance

For each kept image, record the prompt, seed, date and generator, and keep the generator's own file name or ID. Check your Meshy plan's terms. My recollection is that free-plan outputs are published under CC BY 4.0, which means crediting Meshy in `CREDITS.md`, while paid plans give you ownership; confirm on their site. Never name a game, studio or living artist in a prompt.

## Do not generate

- **Normal maps.** Story 3.3 computes them from each sprite's alpha.
- **Fonts.** Use an existing pixel font under the SIL Open Font License.
- **Fire, smoke, water surfaces, skies, fog, particles.** The engine draws these.
- **Lighting.** No baked glows, shadows or blur in any asset.
