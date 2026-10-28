# Cost study: Epic 5

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
| (floor) | one constant-colour pass | 1 | 0.07 | 0.04 | 0.02 to 0.09 |
| (tail) | constant scene + bloom + output | 11 | 0.72 | 0.68 | 0.66 to 0.70 |
| bokeh-highlights | default | 20 | 2.03 | 2.01 | 1.81 to 3.10 |
| bokeh-highlights | preset hexagon | 20 | 1.97 | 1.99 | 1.86 to 2.32 |
| bokeh-highlights | preset round | 20 | 1.97 | 1.97 | 1.68 to 2.42 |
| bokeh-highlights | preset pentagon, straight blades | 20 | 1.90 | 1.94 | 1.86 to 2.49 |
| bokeh-highlights | preset soap bubble | 20 | 1.77 | 1.79 | 1.66 to 1.97 |
| bokeh-highlights | preset cat's eye | 20 | 1.90 | 1.99 | 1.81 to 2.47 |
| bokeh-highlights | preset focus far | 20 | 2.42 | 2.32 | 2.23 to 2.60 |
| bokeh-highlights | preset gather only | 18 | 1.64 | 1.64 | 1.25 to 1.81 |
| colour-grading | default | 12 | 0.66 | 0.59 | 0.50 to 0.98 |
| colour-grading | preset tour | 12 | 0.66 | 0.57 | 0.55 to 0.63 |
| colour-grading | preset day cycle | 12 | 0.59 | 0.59 | 0.50 to 0.83 |
| colour-grading | preset day | 12 | 0.59 | 0.59 | 0.50 to 0.76 |
| colour-grading | preset night | 12 | 0.79 | 0.70 | 0.55 to 0.92 |
| colour-grading | preset the shore at dusk | 12 | 0.59 | 0.52 | 0.37 to 0.70 |
| colour-grading | preset hard cuts | 12 | 0.66 | 0.59 | 0.55 to 0.81 |
| colour-grading | preset ungraded | 12 | 0.72 | 0.59 | 0.50 to 0.90 |
| finishing | default | 12 | 0.79 | 0.87 | 0.57 to 0.98 |
| finishing | preset subtle | 12 | 0.72 | 0.70 | 0.61 to 0.96 |
| finishing | preset film | 12 | 0.72 | 0.76 | 0.63 to 1.14 |
| finishing | preset old lens | 12 | 0.92 | 0.92 | 0.66 to 1.55 |
| finishing | preset heavy grain | 12 | 0.92 | 0.90 | 0.63 to 1.14 |
| finishing | preset none | 12 | 0.72 | 0.63 | 0.20 to 0.92 |
| pixel-bloom | default | 11 | 1.18 | 1.09 | 0.90 to 1.14 |
| pixel-bloom | preset pixel bloom | 11 | 1.18 | 1.09 | 1.07 to 1.14 |
| pixel-bloom | preset tail defaults | 12 | 1.18 | 1.14 | 1.14 to 1.16 |
| pixel-bloom | preset low threshold | 12 | 1.18 | 1.14 | 1.11 to 1.14 |
| pixel-bloom | preset high threshold, averaged | 10 | 1.18 | 1.09 | 1.07 to 1.11 |
| pixel-bloom | preset wide glow | 13 | 1.18 | 1.14 | 1.11 to 1.16 |
| pixel-bloom | preset midday | 11 | 1.18 | 1.09 | 1.07 to 1.11 |
| pixel-bloom | preset midday, tail defaults | 12 | 1.18 | 1.14 | 1.11 to 1.16 |
| pixel-bloom | preset close up | 11 | 0.92 | 0.83 | 0.59 to 1.70 |
| pixel-bloom | preset no bloom | 3 | 0.59 | 0.59 | 0.52 to 0.79 |
| rack-focus | default | 18 | 1.64 | 1.70 | 1.29 to 3.34 |
| rack-focus | preset on a schedule | 18 | 1.77 | 1.81 | 1.49 to 2.12 |
| rack-focus | preset slow pull | 18 | 1.77 | 1.68 | 1.25 to 3.41 |
| rack-focus | preset snap focus | 18 | 1.57 | 1.49 | 1.22 to 2.86 |
| rack-focus | preset scroll story | 18 | 1.77 | 1.81 | 1.27 to 2.21 |
| rack-focus | preset click to focus | 18 | 1.77 | 1.57 | 1.18 to 1.97 |
| rack-focus | preset reduced motion | 18 | 1.77 | 1.70 | 1.27 to 2.10 |
| tilt-shift | default | 18 | 1.84 | 1.68 | 1.49 to 2.29 |
| tilt-shift | preset screen fallback | 16 | 1.11 | 1.38 | 1.22 to 1.70 |
| tilt-shift | preset shallow miniature | 18 | 1.64 | 1.64 | 1.11 to 1.81 |
| tilt-shift | preset focus far | 18 | 1.84 | 1.77 | 1.18 to 2.16 |
| tilt-shift | preset focus near | 18 | 1.44 | 1.51 | 1.33 to 1.75 |
| tilt-shift | preset deep focus | 18 | 1.70 | 1.40 | 1.25 to 3.45 |
| tilt-shift | preset no lens | 12 | 0.79 | 0.79 | 0.61 to 0.98 |
| tilt-shift | preset single-sampled depth | 18 | 1.44 | 1.55 | 1.27 to 1.81 |
| tilt-shift | method=off | 12 | 1.18 | 1.11 | 0.59 to 1.16 |
| tilt-shift | method=screen | 16 | 1.44 | 1.38 | 0.87 to 1.73 |
| tilt-shift | method=depth | 18 | 1.64 | 1.55 | 1.25 to 2.53 |
| tilt-shift | maxBlur=0.75 | 18 | 1.77 | 1.68 | 1.40 to 3.74 |
| tilt-shift | maxBlur=1.5 | 18 | 1.84 | 1.68 | 1.53 to 3.84 |
| tilt-shift | maxBlur=3 | 18 | 1.70 | 1.70 | 1.29 to 3.43 |
| tilt-shift | maxBlur=4 | 18 | 1.70 | 1.66 | 1.46 to 1.77 |
| tilt-shift | msaa=false | 18 | 1.84 | 1.75 | 1.38 to 2.29 |

## 1266 × 585

| Effect | Configuration | Passes | Span (ms) | Per frame (ms) | Range (ms) |
| --- | --- | ---: | ---: | ---: | --- |
| (floor) | one constant-colour pass | 1 | 0.07 | 0.04 | 0.04 to 0.09 |
| (tail) | constant scene + bloom + output | 9 | 0.46 | 0.33 | 0.28 to 0.42 |
| bokeh-highlights | default | 18 | 1.38 | 1.25 | 1.00 to 2.36 |
| bokeh-highlights | preset hexagon | 18 | 1.38 | 1.29 | 0.96 to 2.47 |
| bokeh-highlights | preset round | 18 | 2.03 | 1.75 | 1.46 to 2.38 |
| bokeh-highlights | preset pentagon, straight blades | 18 | 1.38 | 1.27 | 0.98 to 2.45 |
| bokeh-highlights | preset soap bubble | 18 | 1.25 | 1.20 | 0.87 to 2.40 |
| bokeh-highlights | preset cat's eye | 18 | 1.31 | 1.16 | 0.92 to 2.38 |
| bokeh-highlights | preset focus far | 18 | 1.51 | 1.40 | 0.96 to 3.04 |
| bokeh-highlights | preset gather only | 16 | 1.05 | 1.00 | 0.79 to 1.92 |
| colour-grading | default | 10 | 0.46 | 0.35 | 0.22 to 0.81 |
| colour-grading | preset tour | 10 | 0.46 | 0.37 | 0.31 to 0.83 |
| colour-grading | preset day cycle | 10 | 0.39 | 0.35 | 0.31 to 0.81 |
| colour-grading | preset day | 10 | 0.39 | 0.35 | 0.33 to 0.81 |
| colour-grading | preset night | 10 | 0.46 | 0.39 | 0.33 to 0.50 |
| colour-grading | preset the shore at dusk | 10 | 0.39 | 0.35 | 0.20 to 0.76 |
| colour-grading | preset hard cuts | 10 | 0.39 | 0.35 | 0.33 to 0.83 |
| colour-grading | preset ungraded | 10 | 0.46 | 0.35 | 0.22 to 0.83 |
| finishing | default | 10 | 0.46 | 0.35 | 0.33 to 0.92 |
| finishing | preset subtle | 10 | 0.52 | 0.35 | 0.33 to 0.74 |
| finishing | preset film | 10 | 0.46 | 0.35 | 0.33 to 0.92 |
| finishing | preset old lens | 10 | 0.52 | 0.33 | 0.33 to 0.72 |
| finishing | preset heavy grain | 10 | 0.46 | 0.35 | 0.24 to 0.92 |
| finishing | preset none | 10 | 0.46 | 0.33 | 0.31 to 0.59 |
| pixel-bloom | default | 9 | 0.39 | 0.31 | 0.26 to 0.35 |
| pixel-bloom | preset pixel bloom | 9 | 0.39 | 0.42 | 0.33 to 0.55 |
| pixel-bloom | preset tail defaults | 10 | 0.66 | 0.57 | 0.55 to 0.61 |
| pixel-bloom | preset low threshold | 10 | 0.66 | 0.57 | 0.57 to 0.61 |
| pixel-bloom | preset high threshold, averaged | 8 | 0.33 | 0.31 | 0.24 to 0.37 |
| pixel-bloom | preset wide glow | 11 | 0.59 | 0.59 | 0.46 to 0.61 |
| pixel-bloom | preset midday | 9 | 0.59 | 0.55 | 0.52 to 0.57 |
| pixel-bloom | preset midday, tail defaults | 10 | 0.66 | 0.57 | 0.57 to 0.61 |
| pixel-bloom | preset close up | 9 | 0.85 | 0.79 | 0.76 to 0.81 |
| pixel-bloom | preset no bloom | 3 | 0.39 | 0.33 | 0.33 to 0.35 |
| rack-focus | default | 16 | 1.11 | 1.07 | 0.83 to 1.94 |
| rack-focus | preset on a schedule | 16 | 1.11 | 1.14 | 0.79 to 2.12 |
| rack-focus | preset slow pull | 16 | 1.11 | 1.03 | 0.74 to 2.29 |
| rack-focus | preset snap focus | 16 | 1.11 | 1.07 | 0.87 to 2.05 |
| rack-focus | preset scroll story | 16 | 1.05 | 1.03 | 0.63 to 2.01 |
| rack-focus | preset click to focus | 16 | 1.11 | 1.03 | 0.90 to 1.97 |
| rack-focus | preset reduced motion | 16 | 1.11 | 1.11 | 0.81 to 2.03 |
| tilt-shift | default | 16 | 1.51 | 1.55 | 1.25 to 1.90 |
| tilt-shift | preset screen fallback | 14 | 0.85 | 0.79 | 0.76 to 0.81 |
| tilt-shift | preset shallow miniature | 16 | 1.05 | 0.90 | 0.81 to 1.86 |
| tilt-shift | preset focus far | 16 | 1.77 | 1.27 | 0.87 to 2.10 |
| tilt-shift | preset focus near | 16 | 0.98 | 0.98 | 0.72 to 1.79 |
| tilt-shift | preset deep focus | 16 | 1.57 | 1.62 | 1.22 to 1.84 |
| tilt-shift | preset no lens | 10 | 0.66 | 0.57 | 0.57 to 0.59 |
| tilt-shift | preset single-sampled depth | 16 | 0.98 | 0.96 | 0.81 to 1.09 |
| tilt-shift | method=off | 10 | 0.66 | 0.57 | 0.57 to 0.59 |
| tilt-shift | method=screen | 14 | 0.85 | 0.79 | 0.76 to 0.83 |
| tilt-shift | method=depth | 16 | 0.98 | 0.94 | 0.66 to 1.77 |
| tilt-shift | maxBlur=0.75 | 16 | 0.98 | 0.96 | 0.59 to 1.77 |
| tilt-shift | maxBlur=1.5 | 16 | 1.44 | 1.38 | 0.72 to 1.88 |
| tilt-shift | maxBlur=3 | 16 | 1.18 | 1.22 | 0.72 to 1.81 |
| tilt-shift | maxBlur=4 | 16 | 1.51 | 1.53 | 0.68 to 2.05 |
| tilt-shift | msaa=false | 16 | 1.11 | 1.27 | 1.07 to 1.99 |

## Download size

What the page fetches to show the effect, beyond the first-load bundle (13.6 kB gzipped, no shaders).

| Effect | Chunks | Own chunk (kB gzip) | Total (kB gzip) |
| --- | ---: | ---: | ---: |
| bokeh-highlights | 26 | 7.3 | 65.0 |
| colour-grading | 31 | 1.5 | 63.5 |
| finishing | 31 | 1.0 | 63.0 |
| pixel-bloom | 30 | 1.4 | 62.9 |
| rack-focus | 27 | 2.4 | 60.5 |
| tilt-shift | 26 | 1.4 | 59.1 |
