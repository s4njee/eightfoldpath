# Credits and third-party notices

Eightfold Path's code is MIT licensed (see [LICENSE](LICENSE)). The art is a separate case,
described below.

## Art

Every image and model under `assets/` was generated with [Meshy](https://www.meshy.ai) for this
repository, then cleaned up by `scripts/clean-art.mjs`. `assets/manifest.json` records each file's
generator, model, task ID, prompt and cleanup; `art/generation-log.json` and `art/selected.json`
record every generation, including rejected variations.

**Licence status: not yet confirmed.** Meshy's terms for redistributing generated output depend on
the account's plan: as far as we know, free-plan output is published under CC BY 4.0, which
requires crediting Meshy, while paid plans assign ownership to the user. Check the plan used and
Meshy's current terms, then replace this paragraph with the confirmed licence, before the repository
is made public. Purely AI-generated images may also not be protected by copyright in some countries,
including the United States.

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
