# Cost study: Epic 4

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
| (floor) | one constant-colour pass | 1 | 0.07 | 0.07 | 0.04 to 0.09 |
| (tail) | constant scene + bloom + output | 11 | 0.72 | 0.68 | 0.66 to 0.72 |
| camera-rig | default | 12 | 1.25 | 1.16 | 1.14 to 1.18 |
| camera-rig | preset explore | 12 | 1.25 | 1.16 | 1.14 to 1.18 |
| camera-rig | preset guided tour | 12 | 1.25 | 1.16 | 1.16 to 1.18 |
| camera-rig | preset scroll story | 12 | 1.25 | 1.16 | 1.14 to 1.18 |
| camera-rig | preset orthographic | 12 | 1.25 | 1.16 | 1.16 to 1.18 |
| camera-rig | preset no parallax | 12 | 1.25 | 1.16 | 1.14 to 1.18 |
| diorama | default | 12 | 1.25 | 1.16 | 1.14 to 1.18 |
| diorama | preset afternoon | 12 | 1.25 | 1.16 | 1.16 to 1.18 |
| diorama | preset evening | 12 | 1.25 | 1.16 | 1.14 to 1.20 |
| diorama | preset top down | 12 | 0.66 | 0.66 | 0.46 to 1.25 |
| diorama | preset hard seams | 12 | 1.18 | 1.14 | 0.72 to 1.18 |
| diorama | preset no sun | 11 | 0.98 | 0.92 | 0.92 to 0.92 |
| diorama | shadows=false | 11 | 0.98 | 0.92 | 0.92 to 0.94 |
| diorama | lamps=false | 12 | 0.59 | 0.55 | 0.48 to 0.70 |
| camera-rig | projection=perspective | 12 | 1.25 | 1.16 | 1.14 to 1.20 |
| camera-rig | projection=orthographic | 12 | 1.25 | 1.16 | 1.16 to 1.20 |

## 1266 × 585

| Effect | Configuration | Passes | Span (ms) | Per frame (ms) | Range (ms) |
| --- | --- | ---: | ---: | ---: | --- |
| (floor) | one constant-colour pass | 1 | 0.07 | 0.04 | 0.04 to 0.09 |
| (tail) | constant scene + bloom + output | 9 | 0.52 | 0.37 | 0.35 to 0.42 |
| camera-rig | default | 10 | 0.66 | 0.59 | 0.57 to 0.59 |
| camera-rig | preset explore | 10 | 0.66 | 0.59 | 0.57 to 0.61 |
| camera-rig | preset guided tour | 10 | 0.66 | 0.59 | 0.57 to 0.59 |
| camera-rig | preset scroll story | 10 | 0.66 | 0.59 | 0.57 to 0.61 |
| camera-rig | preset orthographic | 10 | 0.66 | 0.59 | 0.57 to 0.61 |
| camera-rig | preset no parallax | 10 | 0.66 | 0.59 | 0.57 to 0.61 |
| diorama | default | 10 | 0.66 | 0.59 | 0.57 to 0.61 |
| diorama | preset afternoon | 10 | 0.66 | 0.59 | 0.55 to 0.61 |
| diorama | preset evening | 10 | 0.66 | 0.59 | 0.57 to 0.59 |
| diorama | preset top down | 10 | 0.66 | 0.61 | 0.59 to 0.61 |
| diorama | preset hard seams | 10 | 0.66 | 0.59 | 0.57 to 0.61 |
| diorama | preset no sun | 9 | 0.52 | 0.46 | 0.44 to 0.48 |
| diorama | shadows=false | 9 | 0.52 | 0.46 | 0.44 to 0.48 |
| diorama | lamps=false | 10 | 0.66 | 0.55 | 0.52 to 0.57 |
| camera-rig | projection=perspective | 10 | 0.66 | 0.59 | 0.55 to 0.59 |
| camera-rig | projection=orthographic | 10 | 0.66 | 0.59 | 0.57 to 0.61 |

## Download size

What the page fetches to show the effect, beyond the first-load bundle (10.7 kB gzipped, no shaders).

| Effect | Chunks | Own chunk (kB gzip) | Total (kB gzip) |
| --- | ---: | ---: | ---: |
| camera-rig | 22 | 1.4 | 50.2 |
| diorama | 21 | 1.2 | 49.6 |
