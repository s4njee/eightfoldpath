# Cost study: Epic 5

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
| (floor) | one constant-colour pass | 1 | 0.07 | 0.07 | 0.02 to 0.09 |
| (tail) | constant scene + bloom + output | 11 | 0.52 | 0.37 | 0.35 to 0.68 |
| tilt-shift | default | 18 | 1.84 | 1.73 | 1.44 to 2.29 |
| tilt-shift | preset screen fallback | 16 | 1.38 | 1.29 | 1.07 to 1.77 |
| tilt-shift | preset shallow miniature | 18 | 1.70 | 1.73 | 1.22 to 2.88 |
| tilt-shift | preset focus far | 18 | 1.77 | 1.57 | 1.20 to 1.99 |
| tilt-shift | preset focus near | 18 | 1.77 | 1.77 | 1.35 to 1.88 |
| tilt-shift | preset deep focus | 18 | 1.64 | 1.59 | 1.38 to 2.97 |
| tilt-shift | preset no lens | 12 | 1.18 | 1.11 | 0.76 to 1.16 |
| tilt-shift | preset single-sampled depth | 18 | 1.84 | 1.86 | 1.46 to 2.67 |
| tilt-shift | method=off | 12 | 0.98 | 0.94 | 0.70 to 1.14 |
| tilt-shift | method=screen | 16 | 0.85 | 0.87 | 0.57 to 1.66 |
| tilt-shift | method=depth | 18 | 1.51 | 1.59 | 1.03 to 2.32 |
| tilt-shift | maxBlur=0.75 | 18 | 1.77 | 1.68 | 1.27 to 2.08 |
| tilt-shift | maxBlur=1.5 | 18 | 1.64 | 1.66 | 1.29 to 2.08 |
| tilt-shift | maxBlur=3 | 18 | 1.90 | 1.81 | 1.35 to 2.12 |
| tilt-shift | maxBlur=4 | 18 | 1.57 | 1.55 | 0.98 to 3.04 |
| tilt-shift | msaa=false | 18 | 1.51 | 1.53 | 1.33 to 1.77 |

## 1266 × 585

| Effect | Configuration | Passes | Span (ms) | Per frame (ms) | Range (ms) |
| --- | --- | ---: | ---: | ---: | --- |
| (floor) | one constant-colour pass | 1 | 0.00 | 0.07 | 0.02 to 0.09 |
| (tail) | constant scene + bloom + output | 9 | 0.46 | 0.31 | 0.26 to 0.37 |
| tilt-shift | default | 16 | 1.70 | 1.64 | 1.18 to 1.84 |
| tilt-shift | preset screen fallback | 14 | 0.85 | 0.79 | 0.76 to 0.79 |
| tilt-shift | preset shallow miniature | 16 | 0.98 | 0.98 | 0.81 to 1.86 |
| tilt-shift | preset focus far | 16 | 1.11 | 1.14 | 0.87 to 2.14 |
| tilt-shift | preset focus near | 16 | 1.51 | 1.25 | 0.68 to 1.81 |
| tilt-shift | preset deep focus | 16 | 1.51 | 1.57 | 1.03 to 1.88 |
| tilt-shift | preset no lens | 10 | 0.66 | 0.57 | 0.57 to 0.59 |
| tilt-shift | preset single-sampled depth | 16 | 0.98 | 0.98 | 0.57 to 1.75 |
| tilt-shift | method=off | 10 | 0.52 | 0.46 | 0.35 to 0.59 |
| tilt-shift | method=screen | 14 | 0.85 | 0.79 | 0.76 to 0.79 |
| tilt-shift | method=depth | 16 | 1.57 | 1.64 | 1.07 to 1.86 |
| tilt-shift | maxBlur=0.75 | 16 | 0.98 | 0.98 | 0.61 to 1.81 |
| tilt-shift | maxBlur=1.5 | 16 | 1.70 | 1.66 | 1.33 to 1.84 |
| tilt-shift | maxBlur=3 | 16 | 0.98 | 0.98 | 0.59 to 1.84 |
| tilt-shift | maxBlur=4 | 16 | 0.98 | 0.96 | 0.61 to 1.84 |
| tilt-shift | msaa=false | 16 | 1.18 | 1.42 | 0.61 to 1.97 |

## Download size

What the page fetches to show the effect, beyond the first-load bundle (10.7 kB gzipped, no shaders).

| Effect | Chunks | Own chunk (kB gzip) | Total (kB gzip) |
| --- | ---: | ---: | ---: |
| tilt-shift | 21 | 8.9 | 57.3 |
