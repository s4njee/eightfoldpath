# Cost study: Epic 9

Measured 2026-10-27 on **Apple M1 Max** (apple-silicon), Dawn (node webgpu bindings).

Method: GPU timestamps: frame span (first pass start to last pass end) and marginal cost per extra frame. 12 warm-up frames, then the median of 11 rounds; each round encodes the frame once and 4 times in one command buffer.

- **span** is one frame alone, first pass start to last pass end. It includes the timing floor of this adapter (the `(floor)` row).
- **per frame** is the cost of one more frame of the same work (the slope). It is the number to compare effects by, and the one the Scorecard shows.
- `(tail)` is the HDR tail alone at its default settings. Every effect below includes it.

Only this adapter was measured. spanMs includes the timing floor (see the "(floor)" rows); slopeMs is the cost of one more frame of the same work and is the number to compare by. A slope at or below zero means the work is below what this method can resolve.

Two limits on reading these numbers. Repeated runs of a light effect differ by up to about half a millisecond (see the Range column), and a GPU's clock follows its load, so a light effect can read slower per unit of work than a heavy one: differences under about half a millisecond mean nothing. And the Tier A and B budgets are set for an integrated GPU; a time measured on a faster one can show an effect is over budget but cannot show that it fits.

## 1920 × 1080

| Effect | Configuration | Passes | Span (ms) | Per frame (ms) | Range (ms) |
| --- | --- | ---: | ---: | ---: | --- |
| (floor) | one constant-colour pass | 1 | 0.07 | 0.07 | 0.02 to 0.11 |
| (tail) | constant scene + bloom + output | 11 | 0.52 | 0.39 | 0.33 to 0.68 |
| parallax-header | default | 15 | 0.66 | 0.63 | 0.55 to 0.87 |
| parallax-header | preset focus on the foreground | 15 | 1.25 | 1.14 | 0.90 to 1.25 |
| parallax-header | preset focus on the distance | 15 | 1.25 | 1.11 | 1.09 to 1.16 |
| parallax-header | preset everything sharp | 15 | 1.31 | 1.22 | 1.20 to 1.25 |
| parallax-header | preset no shafts | 11 | 0.98 | 0.96 | 0.94 to 1.00 |
| parallax-header | preset plain | 2 | 0.72 | 0.63 | 0.61 to 0.68 |
| parallax-header | shafts=0 | 11 | 1.05 | 0.98 | 0.92 to 1.03 |
| parallax-header | aperture=0 | 15 | 1.31 | 1.25 | 1.22 to 1.25 |

## 1266 × 585

| Effect | Configuration | Passes | Span (ms) | Per frame (ms) | Range (ms) |
| --- | --- | ---: | ---: | ---: | --- |
| (floor) | one constant-colour pass | 1 | 0.07 | 0.04 | 0.02 to 0.09 |
| (tail) | constant scene + bloom + output | 9 | 0.52 | 0.37 | 0.37 to 0.39 |
| parallax-header | default | 13 | 0.66 | 0.61 | 0.57 to 0.63 |
| parallax-header | preset focus on the foreground | 13 | 0.66 | 0.59 | 0.59 to 0.63 |
| parallax-header | preset focus on the distance | 13 | 0.66 | 0.59 | 0.57 to 0.61 |
| parallax-header | preset everything sharp | 13 | 0.72 | 0.63 | 0.61 to 0.63 |
| parallax-header | preset no shafts | 9 | 0.52 | 0.48 | 0.46 to 0.50 |
| parallax-header | preset plain | 2 | 0.33 | 0.26 | 0.26 to 0.28 |
| parallax-header | shafts=0 | 9 | 0.52 | 0.48 | 0.46 to 0.50 |
| parallax-header | aperture=0 | 13 | 0.66 | 0.63 | 0.59 to 0.66 |

## Download size

What the page fetches to show the effect, beyond the first-load bundle (10.7 kB gzipped, no shaders).

| Effect | Chunks | Own chunk (kB gzip) | Total (kB gzip) |
| --- | ---: | ---: | ---: |
| parallax-header | 14 | 6.0 | 29.9 |
