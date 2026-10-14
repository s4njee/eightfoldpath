# Credits and third-party notices

Eightfold Path is MIT licensed (see [LICENSE](LICENSE)), its AI-generated art included, as
described below.

## Art

Every image and model under `assets/` was generated with [Meshy](https://www.meshy.ai) for this
repository, then cleaned up by `scripts/clean-art.mjs`. `assets/manifest.json` records each file's
generator, model, task ID, prompt and cleanup; `art/generation-log.json` and `art/selected.json`
record every generation, including rejected variations.

**Licence.** The art was generated on a paid Meshy plan. Under
[Meshy's terms of use](https://www.meshy.ai/terms-of-use), section 3.2, customers on a paid plan own
their output "to the extent possible under applicable law", and the terms place no restriction on
redistributing it (section 2.6 restricts reselling the Meshy service itself, not its output). The art
is redistributed here under the repository's MIT licence. Two caveats from the same terms: AI output
"may not qualify for intellectual property protection" (section 7.2), and Meshy does not guarantee
it is unique or unlike existing work. Every selected image was reviewed by eye, and variations were
rejected for a national flag on a shield and for a religious symbol with rune-like lettering; this
was not a systematic search against existing characters or artwork.

**AI identifiers.** Meshy marks each generated image with XMP metadata (`meshy:AIGenerated`, the
model, and a content ID), and section 2.4 of its terms forbids removing or altering such identifiers.
`scripts/clean-art.mjs` copies that metadata unchanged into every cleaned image, and
`scripts/check-assets.mjs` fails the build if a Meshy image is missing it. The 3D models carry no
such marker.

No prompt named a game, studio or artist, and no game screenshot was used as a reference. The
style these effects recreate is described from technique, not copied from any game's assets.

The 48-colour palette (`assets/palette/`) is derived from the generated art by
`scripts/clean-art.mjs` and is part of this repository.

## Code from sibling projects

The gallery shell, test harness and build scripts were copied from
[Fire Temple](https://github.com/s4njee/firetemple) (MIT). The GPU core, passes, post chain and
shared WGSL library come from `@mk7s/hologpu-temple-core` (MIT).

## Algorithms and references

Each effect cites its sources in `src/effects/<id>/notes.md`. The inherited HDR tail uses
Krzysztof Narkowicz's ACES filmic curve.
