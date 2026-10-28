# Cost study: Epic 9

Measured 2026-10-28 on **Apple M1 Max** (apple-silicon), Dawn (node webgpu bindings).

Method: GPU timestamps: frame span (first pass start to last pass end) and marginal cost per extra frame. 12 warm-up frames, then the median of 11 rounds; each round encodes the frame once and 4 times in one command buffer.

- **span** is one frame alone, first pass start to last pass end. It includes the timing floor of this adapter (the `(floor)` row).
- **per frame** is the cost of one more frame of the same work (the slope). It is the number to compare effects by, and the one the Scorecard shows.
- `(tail)` is the HDR tail alone at its default settings. Every effect below includes it.

Only this adapter was measured. spanMs includes the timing floor (see the "(floor)" rows); slopeMs is the cost of one more frame of the same work and is the number to compare by. A slope at or below zero means the work is below what this method can resolve.

Two limits on reading these numbers. Repeated runs of a light effect differ by up to about half a millisecond (see the Range column), and a GPU's clock follows its load, so a light effect can read slower per unit of work than a heavy one: differences under about half a millisecond mean nothing. And the Tier A and B budgets are set for an integrated GPU; a time measured on a faster one can show an effect is over budget but cannot show that it fits.

## 1920 × 1080

| Effect | Configuration | Passes | Span (ms) | Per frame (ms) | Range (ms) |
| --- | --- | ---: | ---: | ---: | --- |
| (floor) | one constant-colour pass | 1 | 0.07 | 0.07 | 0.04 to 0.09 |
| (tail) | constant scene + bloom + output | 11 | 0.72 | 0.68 | 0.66 to 0.70 |
| dialogue-box | default | 2 | 0.46 | 0.37 | 0.35 to 0.39 |
| dialogue-box | preset reader paced | 2 | 0.39 | 0.37 | 0.35 to 0.39 |
| dialogue-box | preset slow storyteller | 2 | 0.39 | 0.37 | 0.35 to 0.39 |
| dialogue-box | preset welcome tour | 2 | 0.46 | 0.37 | 0.35 to 0.39 |
| dialogue-box | preset over the page | 2 | 0.39 | 0.39 | 0.37 to 0.42 |
| hero-diorama | default | 18 | 1.77 | 1.68 | 1.38 to 2.38 |
| hero-diorama | preset tour | 18 | 1.84 | 1.55 | 1.27 to 2.12 |
| hero-diorama | preset scroll story | 18 | 1.51 | 1.53 | 1.35 to 2.27 |
| hero-diorama | preset snap focus | 18 | 1.44 | 1.59 | 1.40 to 2.10 |
| hero-diorama | preset screen lens | 16 | 1.05 | 1.00 | 0.76 to 1.51 |
| hero-diorama | preset no lens | 12 | 0.72 | 0.68 | 0.66 to 0.87 |
| menu-windows | default | 2 | 0.59 | 0.50 | 0.46 to 0.55 |
| menu-windows | preset frosted glass | 2 | 0.52 | 0.52 | 0.50 to 0.55 |
| menu-windows | preset thin glass | 2 | 0.52 | 0.52 | 0.50 to 0.52 |
| menu-windows | preset deep blur | 2 | 0.52 | 0.52 | 0.50 to 0.55 |
| menu-windows | preset live diorama | 3 | 1.11 | 1.03 | 1.03 to 1.07 |
| parallax-header | default | 15 | 1.18 | 1.14 | 1.14 to 1.16 |
| parallax-header | preset focus on the foreground | 15 | 0.66 | 0.63 | 0.57 to 0.76 |
| parallax-header | preset focus on the distance | 15 | 1.18 | 1.11 | 0.90 to 1.16 |
| parallax-header | preset everything sharp | 15 | 1.31 | 1.25 | 1.25 to 1.27 |
| parallax-header | preset no shafts | 11 | 0.98 | 0.98 | 0.94 to 1.00 |
| parallax-header | preset plain | 2 | 0.72 | 0.63 | 0.50 to 0.66 |
| pixelate-hover | default | 2 | 0.26 | 0.22 | 0.15 to 0.42 |
| pixelate-hover | preset pixelate on hover | 2 | 0.26 | 0.11 | 0.02 to 0.24 |
| pixelate-hover | preset mosaic, a pixel at a time | 2 | 0.46 | 0.42 | 0.02 to 0.42 |
| pixelate-hover | preset forest, blue noise | 2 | 0.33 | 0.26 | 0.15 to 0.26 |
| pixelate-hover | preset harbour, chunky, no dither | 2 | 0.46 | 0.42 | 0.07 to 0.42 |
| pointer-lit-sprite | default | 2 | 0.26 | 0.17 | 0.13 to 0.55 |
| pointer-lit-sprite | preset smooth light | 2 | 0.26 | 0.15 | 0.13 to 0.24 |
| pointer-lit-sprite | preset lantern | 2 | 0.26 | 0.20 | 0.17 to 0.33 |
| pointer-lit-sprite | preset full figure | 2 | 0.52 | 0.39 | 0.26 to 0.55 |
| pointer-lit-sprite | preset knight, no frame | 2 | 0.52 | 0.44 | 0.44 to 0.46 |
| pointer-lit-sprite | preset this canvas only | 2 | 0.59 | 0.50 | 0.50 to 0.52 |
| parallax-header | shafts=0 | 11 | 0.98 | 0.98 | 0.98 to 1.00 |
| parallax-header | aperture=0 | 15 | 1.31 | 1.25 | 1.22 to 1.27 |

## 1266 × 585

| Effect | Configuration | Passes | Span (ms) | Per frame (ms) | Range (ms) |
| --- | --- | ---: | ---: | ---: | --- |
| (floor) | one constant-colour pass | 1 | 0.07 | 0.04 | 0.04 to 0.09 |
| (tail) | constant scene + bloom + output | 9 | 0.52 | 0.35 | 0.33 to 0.44 |
| dialogue-box | default | 2 | 0.26 | 0.20 | 0.17 to 0.22 |
| dialogue-box | preset reader paced | 2 | 0.20 | 0.20 | 0.17 to 0.22 |
| dialogue-box | preset slow storyteller | 2 | 0.20 | 0.20 | 0.17 to 0.22 |
| dialogue-box | preset welcome tour | 2 | 0.20 | 0.20 | 0.17 to 0.22 |
| dialogue-box | preset over the page | 2 | 0.20 | 0.17 | 0.17 to 0.20 |
| hero-diorama | default | 16 | 0.79 | 0.72 | 0.70 to 0.85 |
| hero-diorama | preset tour | 16 | 0.79 | 0.72 | 0.70 to 0.72 |
| hero-diorama | preset scroll story | 16 | 0.79 | 0.72 | 0.22 to 2.21 |
| hero-diorama | preset snap focus | 16 | 0.79 | 0.72 | 0.68 to 0.76 |
| hero-diorama | preset screen lens | 14 | 0.59 | 0.52 | 0.48 to 0.85 |
| hero-diorama | preset no lens | 10 | 0.46 | 0.35 | 0.22 to 0.90 |
| menu-windows | default | 2 | 0.20 | 0.20 | 0.07 to 0.22 |
| menu-windows | preset frosted glass | 2 | 0.26 | 0.20 | 0.09 to 0.22 |
| menu-windows | preset thin glass | 2 | 0.26 | 0.20 | 0.15 to 0.22 |
| menu-windows | preset deep blur | 2 | 0.26 | 0.20 | 0.17 to 0.22 |
| menu-windows | preset live diorama | 3 | 0.52 | 0.48 | 0.46 to 0.50 |
| parallax-header | default | 13 | 0.66 | 0.61 | 0.59 to 0.61 |
| parallax-header | preset focus on the foreground | 13 | 0.66 | 0.61 | 0.59 to 0.61 |
| parallax-header | preset focus on the distance | 13 | 0.66 | 0.59 | 0.57 to 0.61 |
| parallax-header | preset everything sharp | 13 | 0.72 | 0.63 | 0.63 to 0.68 |
| parallax-header | preset no shafts | 9 | 0.52 | 0.50 | 0.48 to 0.50 |
| parallax-header | preset plain | 2 | 0.33 | 0.26 | 0.24 to 0.28 |
| pixelate-hover | default | 2 | 0.20 | 0.15 | 0.07 to 0.17 |
| pixelate-hover | preset pixelate on hover | 2 | 0.20 | 0.11 | 0.09 to 0.13 |
| pixelate-hover | preset mosaic, a pixel at a time | 2 | 0.13 | 0.09 | 0.09 to 0.11 |
| pixelate-hover | preset forest, blue noise | 2 | 0.26 | 0.20 | 0.20 to 0.22 |
| pixelate-hover | preset harbour, chunky, no dither | 2 | 0.20 | 0.15 | 0.07 to 0.20 |
| pointer-lit-sprite | default | 2 | 0.13 | 0.09 | 0.09 to 0.24 |
| pointer-lit-sprite | preset smooth light | 2 | 0.13 | 0.09 | 0.07 to 0.09 |
| pointer-lit-sprite | preset lantern | 2 | 0.26 | 0.20 | 0.09 to 0.22 |
| pointer-lit-sprite | preset full figure | 2 | 0.20 | 0.11 | 0.04 to 0.22 |
| pointer-lit-sprite | preset knight, no frame | 2 | 0.13 | 0.11 | 0.07 to 0.11 |
| pointer-lit-sprite | preset this canvas only | 2 | 0.20 | 0.13 | 0.11 to 0.22 |
| parallax-header | shafts=0 | 9 | 0.39 | 0.35 | 0.31 to 0.39 |
| parallax-header | aperture=0 | 13 | 0.59 | 0.63 | 0.52 to 0.68 |

## Download size

What the page fetches to show the effect, beyond the first-load bundle (13.6 kB gzipped, no shaders).

| Effect | Chunks | Own chunk (kB gzip) | Total (kB gzip) |
| --- | ---: | ---: | ---: |
| dialogue-box | 14 | 6.1 | 30.3 |
| hero-diorama | 32 | 2.1 | 72.5 |
| menu-windows | 33 | 7.6 | 66.0 |
| parallax-header | 14 | 6.0 | 30.0 |
| pixelate-hover | 14 | 2.6 | 27.9 |
| pointer-lit-sprite | 22 | 3.5 | 34.9 |
