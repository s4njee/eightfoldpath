# Eightfold Path — Meshy prompts

Copy-paste prompts for the test set in [art.md](art.md), in the same order and with the same numbers. Generate the **first batch** first; it covers every experiment up to milestone M1.

## How to use them

**Through the API:** `node scripts/meshy.mjs` reads this file, plans a batch and estimates its credits; add `--go` to generate. It needs `MESHY_API_KEY` in the environment or in a git-ignored `.env` here, writes each variation as `<name>-v1.png`, `-v2.png` and so on, skips files that already exist, and logs every task to `art/generation-log.json`. The API has no negative prompt field; the prompts already carry the same exclusions. Models go through preview and refine with `meshy-6` and `remove_lighting` on, so textures come back without baked lighting. They are remeshed (about 30,000 triangles for dioramas, 15,000 for the character) and textured from a reference image of our own pixel art (`art/reference/`, or the traveller sprite) rather than from text: without those settings Meshy returned 0.5 to 1.4 million triangles and textures that were not pixel art.

**By hand in Meshy's web app:**

- **Mode.** Prompts marked *Image* go into Meshy's text-to-image mode; prompts marked *3D* go into text-to-3D. If Meshy's image mode is weak at pixel art, any image generator will take the same prompts.
- **Negative prompt.** If there is a negative prompt field, paste this into it for every *Image* prompt except the painted illustrations:

  ```text
  blurry, gradient, soft shading, glow, bloom, shadow, drop shadow, depth of field, vignette, photorealistic, 3D render, background scenery, multiple subjects, text, watermark, signature
  ```

- **Variations.** Generate four, keep the one with the clearest pixel grid and the cleanest silhouette, and save it under the file name given.
- **Exact sizes will not be honoured.** The sizes in the prompts steer the level of detail; cleanup sets the real size.
- **Textures will not tile.** Asking for a repeated grid made the generator draw seam lines between the repeats, so the ground and wall prompts ask for one continuous surface instead. Make it seamless in cleanup: offset it by half its size with wrap-around, and repaint the cross-shaped seam that appears.
- **Record each one you keep:** prompt, seed, date, and Meshy's ID for it.

---

## First batch

### 1. Traveller — *Image*
`art/characters/traveller.png`
```text
Pixel art character sprite of a young traveller in a red hooded cloak with a short sword at the hip and brown leather boots, full body, standing still, facing the viewer, seen from slightly above, about 32 pixels tall. Low resolution with large square pixels and a clear pixel grid, no anti-aliasing, about 16 colours, one-pixel dark outline, flat even lighting, no shadows, no glow, centred and fully visible, plain solid magenta background, no scenery, no text.
```

### 2. Slime — *Image*
`art/characters/slime.png`
```text
Pixel art sprite of a round green slime monster with two simple eyes and a glossy dome shape, sitting on the ground, facing the viewer, seen from slightly above, about 24 pixels wide. Low resolution with large square pixels and a clear pixel grid, no anti-aliasing, about 12 colours, one-pixel dark outline, flat even lighting, no shadows, no glow, centred and fully visible, plain solid magenta background, no scenery, no text.
```

### 6. Lantern — *Image*
`art/props/lantern.png`
```text
Pixel art sprite of an old street lantern on a tall wooden post, an iron lamp housing with four glass panes, the glass filled with one single flat bright yellow colour, front view seen from slightly above, about 16 pixels wide and 40 pixels tall. Low resolution with large square pixels and a clear pixel grid, no anti-aliasing, about 12 colours, one-pixel dark outline, flat even lighting, no shadows, no glow or halo around the lamp, centred and fully visible, plain solid magenta background, no scenery, no text.
```

### 7. Barrel — *Image*
`art/props/barrel.png`
```text
Pixel art sprite of a single wooden barrel with two dark iron bands, standing upright, front view seen from slightly above, about 16 pixels wide. Low resolution with large square pixels and a clear pixel grid, no anti-aliasing, about 10 colours, one-pixel dark outline, flat even lighting, no shadows, no glow, centred and fully visible, plain solid magenta background, no scenery, no text.
```

### 8. Tree — *Image*
`art/props/tree.png`
```text
Pixel art sprite of a single broadleaf tree with a round, full canopy of green leaves and a short brown trunk, front view seen from slightly above, about 48 pixels wide and 64 pixels tall. Low resolution with large square pixels and a clear pixel grid, no anti-aliasing, about 16 colours, one-pixel dark outline, flat even lighting, no shadows, no glow, centred and fully visible, plain solid magenta background, no ground, no scenery, no text.
```

### 12. Cobblestone — *Image*
`art/tiles/cobblestone.png`
```text
Pixel art texture of grey cobblestone paving, seen straight down from above, one continuous surface filling the whole square image edge to edge, with no border, no grid lines and no repeated sections. Low resolution with large square pixels and a clear pixel grid, no anti-aliasing, about 8 colours, flat even lighting, no shadows, no perspective, the texture fills the whole image, no text.
```

### 13. Grass — *Image*
`art/tiles/grass.png`
```text
Pixel art texture of short green grass with a few tiny flowers, seen straight down from above, one continuous surface filling the whole square image edge to edge, with no border, no grid lines and no repeated sections. Low resolution with large square pixels and a clear pixel grid, no anti-aliasing, about 8 colours, flat even lighting, no shadows, no perspective, the texture fills the whole image, no text.
```

### 16. House front — *Image*
`art/walls/house-front.png`
```text
Pixel art of the flat front wall of a medieval timber-frame house: cream plaster between dark wooden beams, a stone ground floor, a wooden door and three windows whose panes are one single flat bright yellow colour. Orthographic front elevation with no perspective and no roof, about 48 pixels wide and 48 pixels tall. Low resolution with large square pixels and a clear pixel grid, no anti-aliasing, about 16 colours, flat even lighting, no shadows, no glow, centred and fully visible, plain solid magenta background, no scenery, no text.
```

### 20. Waterfall — *Image*
`art/cycling/waterfall.png`
```text
Pixel art of a small waterfall pouring over a rock ledge into a pool, the water drawn with exactly five flat shades of blue arranged in clear vertical bands and stripes, no gradients, grey rocks on both sides, front view, about 64 by 64 pixels. Low resolution with large square pixels and a clear pixel grid, no anti-aliasing, flat even lighting, no shadows, no glow, no mist, plain solid magenta background behind the rocks, no text.
```

### 22. Parallax: sky — *Image*
`art/parallax/sky.png`
```text
Pixel art sky for a side-scrolling background: a smooth dusk gradient from deep blue at the top to soft orange at the horizon, drawn in visible horizontal colour bands, with three small flat clouds. Wide 16:9 panorama, horizontally tileable so the left and right edges match. Low resolution with large square pixels, no anti-aliasing, no sun, no land, no text.
```

### 23. Parallax: mountains — *Image*
`art/parallax/mountains.png`
```text
Pixel art background layer of distant blue-grey mountain silhouettes with a few snowy peaks, only the mountains, filling the lower half of the image. Wide 16:9 panorama, horizontally tileable so the left and right edges match. Low resolution with large square pixels, no anti-aliasing, about 6 colours, flat even lighting, no shadows, no glow, plain solid magenta above the mountains, no sky, no text.
```

### 24. Parallax: hills — *Image*
`art/parallax/hills.png`
```text
Pixel art background layer of rolling green hills with a few tiny distant trees, only the hills, filling the lower third of the image. Wide 16:9 panorama, horizontally tileable so the left and right edges match. Low resolution with large square pixels, no anti-aliasing, about 8 colours, flat even lighting, no shadows, no glow, plain solid magenta above the hills, no sky, no text.
```

### 25. Parallax: tree line — *Image*
`art/parallax/treeline.png`
```text
Pixel art background layer of a dense line of dark green forest trees with an uneven top edge, only the trees, filling the lower third of the image. Wide 16:9 panorama, horizontally tileable so the left and right edges match. Low resolution with large square pixels, no anti-aliasing, about 8 colours, flat even lighting, no shadows, no glow, plain solid magenta above the trees, no sky, no text.
```

### 26. Parallax: foreground — *Image*
`art/parallax/foreground.png`
```text
Pixel art foreground layer of tall grass, ferns and a few wildflowers along the bottom edge of the image, only the plants, filling the bottom fifth. Wide 16:9 panorama, horizontally tileable so the left and right edges match. Low resolution with large square pixels, no anti-aliasing, about 10 colours, one-pixel dark outline, flat even lighting, no shadows, no glow, plain solid magenta above the plants, no sky, no text.
```

### 27. Painted town — *Image*
`art/illustrations/town.png` — no negative prompt; this one must not be pixel art.
```text
Painterly digital illustration of a medieval market town square at dusk: timber-frame houses, a stone well, market stalls with striped awnings, warm lantern light and a few townspeople. Soft visible brushwork, rich detail, a wide 16:9 composition seen from slightly above. Not pixel art, no text.
```

### 33. Town square diorama — *3D*
`art/models/town-square.glb`
```text
Low-poly diorama of a small medieval town square on a square stone base about 4 by 4 metres: three timber-frame houses with steep shingle roofs, a stone well, a market stall with a striped awning, barrels, crates and two street lanterns. Pixel-art textures with large visible texels. Plain flat-colour textures with no baked lighting, no painted shadows, no ambient occlusion, windows not glowing.
```
If Meshy offers a PBR or separated-lighting texture option, turn it on. Export as GLB.

---

## Later batch

### 3. Mage — *Image*
`art/characters/mage.png`
```text
Pixel art character sprite of a scholar mage in a long deep-blue robe with a wide-brimmed hat, holding a wooden staff topped with a small crystal, full body, standing still, facing the viewer, seen from slightly above, about 32 pixels tall. Low resolution with large square pixels and a clear pixel grid, no anti-aliasing, about 16 colours, one-pixel dark outline, flat even lighting, no shadows, no glow, centred and fully visible, plain solid magenta background, no scenery, no text.
```

### 4. Knight — *Image*
`art/characters/knight.png`
```text
Pixel art character sprite of a stocky armoured knight in steel plate with a large round shield and a short spear, full body, standing still, facing the viewer, seen from slightly above, about 32 pixels tall. Low resolution with large square pixels and a clear pixel grid, no anti-aliasing, about 16 colours, one-pixel dark outline, flat even lighting, no shadows, no glow, centred and fully visible, plain solid magenta background, no scenery, no text.
```

### 5. Slime bounce sheet — *Image*
`art/characters/slime-bounce.png` — frames will not match perfectly; use it to test the flipbook code, not to judge animation.
```text
Pixel art sprite sheet of one round green slime monster bouncing, exactly four frames in a single horizontal row: squashed flat, normal, stretched tall in the air, normal. The slime is the same size, colours and position in every frame, each frame in its own equal square cell. Low resolution with large square pixels and a clear pixel grid, no anti-aliasing, about 12 colours, one-pixel dark outline, flat even lighting, no shadows, plain solid magenta background, no text, no frame borders.
```

### 9. Crystals — *Image*
`art/props/crystals.png`
```text
Pixel art sprite of a cluster of five sharp blue crystals growing from a small grey rock, the crystal faces in three flat shades of cyan with one single flat white highlight colour, front view seen from slightly above, about 32 pixels wide. Low resolution with large square pixels and a clear pixel grid, no anti-aliasing, about 10 colours, one-pixel dark outline, flat even lighting, no shadows, no glow or halo, centred and fully visible, plain solid magenta background, no scenery, no text.
```

### 10. Chest — *Image*
`art/props/chest.png`
```text
Pixel art sprite of a closed wooden treasure chest with gold metal corners and a gold lock, front view seen from slightly above, about 20 pixels wide. Low resolution with large square pixels and a clear pixel grid, no anti-aliasing, about 10 colours, one-pixel dark outline, flat even lighting, no shadows, no glow, no sparkles, centred and fully visible, plain solid magenta background, no scenery, no text.
```

### 11. Boulder — *Image*
`art/props/boulder.png`
```text
Pixel art sprite of a large irregular grey boulder with patches of green moss on top, front view seen from slightly above, about 32 pixels wide. Low resolution with large square pixels and a clear pixel grid, no anti-aliasing, about 10 colours, one-pixel dark outline, flat even lighting, no shadows, no glow, centred and fully visible, plain solid magenta background, no scenery, no text.
```

### 14. Dirt path — *Image*
`art/tiles/dirt-path.png`
```text
Pixel art texture of a packed brown dirt path with small pebbles, seen straight down from above, one continuous surface filling the whole square image edge to edge, with no border, no grid lines and no repeated sections. Low resolution with large square pixels and a clear pixel grid, no anti-aliasing, about 8 colours, flat even lighting, no shadows, no perspective, the texture fills the whole image, no text.
```

### 15. Sand — *Image*
`art/tiles/sand.png`
```text
Pixel art texture of pale desert sand with gentle wind ripples, seen straight down from above, one continuous surface filling the whole square image edge to edge, with no border, no grid lines and no repeated sections. Low resolution with large square pixels and a clear pixel grid, no anti-aliasing, about 6 colours, flat even lighting, no shadows, no perspective, the texture fills the whole image, no text.
```

### 17. Stone wall — *Image*
`art/walls/stone-wall.png`
```text
Pixel art texture of a grey stone block wall, seen flat from the front with no perspective, one continuous surface filling the whole square image edge to edge, with no border, no grid lines and no repeated sections. Low resolution with large square pixels and a clear pixel grid, no anti-aliasing, about 8 colours, flat even lighting, no shadows, the texture fills the whole image, no text.
```

### 18. Cliff face — *Image*
`art/walls/cliff.png`
```text
Pixel art texture of an earth and rock cliff face with horizontal layers of brown soil and grey stone and a strip of grass along the top edge, seen flat from the front with no perspective, one continuous surface filling the whole image edge to edge, with no border, no vertical seams and no repeated sections. Low resolution with large square pixels and a clear pixel grid, no anti-aliasing, about 10 colours, flat even lighting, no shadows, the texture fills the whole image, no text.
```

### 19. Roof — *Image*
`art/walls/roof.png`
```text
Pixel art texture of overlapping red-brown clay roof shingles in neat rows, seen straight on with no perspective, one continuous surface filling the whole square image edge to edge, with no border, no grid lines and no repeated sections. Low resolution with large square pixels and a clear pixel grid, no anti-aliasing, about 8 colours, flat even lighting, no shadows, the texture fills the whole image, no text.
```

### 21. Lava — *Image*
`art/cycling/lava.png`
```text
Pixel art of a pool of molten lava with a few dark crusted rocks floating in it, the lava drawn with exactly five flat shades from dark red to bright yellow arranged in clear swirling bands, no gradients, seen from slightly above, about 64 by 64 pixels. Low resolution with large square pixels and a clear pixel grid, no anti-aliasing, flat even lighting, no shadows, no glow, no smoke, the lava fills the whole image, no text.
```

### 28. Painted forest — *Image*
`art/illustrations/forest.png` — no negative prompt.
```text
Painterly digital illustration of a quiet forest clearing with a small moss-covered stone shrine, tall trees, ferns and soft morning light falling through the leaves. Soft visible brushwork, rich detail, a wide 16:9 composition seen from slightly above. Not pixel art, no text.
```

### 29. Painted harbour — *Image*
`art/illustrations/harbour.png` — no negative prompt.
```text
Painterly digital illustration of a small stone harbour in the rain at evening: a wooden pier, moored sailing boats, warehouses with lit windows, puddles reflecting lantern light. Soft visible brushwork, rich detail, a wide 16:9 composition seen from slightly above. Not pixel art, no text.
```

### 30. Magic circle — *Image*
`art/vfx/magic-circle.png` — white on black rather than magenta, because the engine will add it as light.
```text
A magic circle seen from directly above: three concentric rings, an eight-pointed star made of two overlapping squares, and a ring of simple abstract geometric marks made only of dots, short lines and small circles, not letters from any alphabet. Thin crisp pure white lines on a pure black background, perfectly symmetrical, flat, square image. No glow, no gradients, no colour, no text.
```

### 31. Window frame — *Image*
`art/ui/window-frame.png`
```text
Pixel art user-interface window frame: an empty rectangular parchment panel with a dark wooden border two pixels thick and small brass ornaments in the four corners, seen flat from the front, perfectly symmetrical, about 96 by 64 pixels. Low resolution with large square pixels and a clear pixel grid, no anti-aliasing, about 10 colours, flat even lighting, no shadows, no glow, centred and fully visible, plain solid magenta background, no text inside the panel.
```

### 32. Traveller bust — *Image*
`art/ui/traveller-bust.png` — if Meshy accepts a reference image, give it the traveller sprite from prompt 1.
```text
Pixel art portrait bust of a young traveller in a red hooded cloak, head and shoulders, three-quarter view facing left, calm expression, about 64 by 64 pixels. Low resolution with large square pixels and a clear pixel grid, no anti-aliasing, about 20 colours, one-pixel dark outline, flat even lighting from the front, no shadows, no glow, centred, plain solid magenta background, no text.
```

### 34. Forest clearing diorama — *3D*
`art/models/forest-clearing.glb`
```text
Low-poly diorama of a small forest clearing on a square base about 4 by 4 metres: a moss-covered stone shrine with two stone lanterns, five tall trees with dense leafy canopies around the edge, ferns, rocks and a short stone path. Pixel-art textures with large visible texels. Plain flat-colour textures with no baked lighting, no painted shadows, no ambient occlusion, lanterns not glowing.
```
Turn on the PBR or separated-lighting texture option if offered. Export as GLB.

### 35. Traveller model — *3D*
`art/models/traveller.glb`
```text
Small stylised low-poly character of a young traveller in a red hooded cloak with a short sword at the hip and brown leather boots, chunky proportions with a large head, standing in an A-pose. Pixel-art textures with large visible texels. Plain flat-colour textures with no baked lighting and no painted shadows.
```
The A-pose makes it easier to rig if Meshy's auto-rigging is available to you. Export as GLB.
