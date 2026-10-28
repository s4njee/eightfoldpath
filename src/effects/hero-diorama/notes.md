## How it works

The village (`src/effects/diorama`, staged by `src/gpu/diorama/stage.ts`) behind a landing-page hero, told in four sections: the village, the square, the guard and the road on. Each section is a camera pose and a subject, a point to hold in focus (a character's chest, found from the scene file by art name). `sections.ts` is the choreography, plain arithmetic:

- **Progress** from 0 to 1 runs through the sections. On a real page it is how far the hero has scrolled through the viewport (`scrollProgress` in `src/gpu/diorama/rig.ts`). The gallery's page does not scroll, so with **scroll** chosen the wheel over the canvas stands in; by default the **clock** tours the sections, holding on each for four seconds and travelling for three, there and back so it never jumps from the last to the first.
- **The camera** follows a path through the section poses (the rig's `poseOnPath`: a Catmull–Rom focus, eased angles and distance), so it settles on each section and moves smoothly between them.
- **The focus racks.** It holds on the section's subject until the camera is partway to the next, then pulls to the next subject over a window around the midpoint (`rack`, a third of the way by default; 0 snaps). Each subject's focus distance is measured along the view axis from the current camera (`viewDistance`), so the focus stays on the subject while the camera moves. This is how a camera operator works: the new subject is in frame before the focus goes to it.
- **The lens** is story 5.1's depth gather (`src/gpu/lens/tilt-shift.ts`) with a 3-unit band, its transitions scaled with the camera's distance so a close shot is as shallow as the wide one; the screen lens is there for comparison and as the fallback.

After the lens comes story 5.4 to 5.8's tail (`src/gpu/post-fx/`): the pixel bloom, so only the lamps' glass glows; a grade that follows the camera's focus from area to area of the village (the colour-grading effect's looks: warm lamplight in the square, lusher greens on the road on, a brighter shore), crossfading over a second and a half; and a subtle vignette, grain and edge aberration.

On a narrow canvas the camera backs off so a subject keeps its surroundings. The inspector shows the **circle of confusion** and switches off the lens, the shadows, the bloom, the grade and the finishing.

## Cost

**Study** (`npm run study -- --epic 9`, [docs/studies/epic-9.md](../../../docs/studies/epic-9.md), Apple M1 Max on Dawn, marginal cost per frame with the tail, at the defaults): **1.7 ms at 1920 × 1080 and 0.72 ms at 1266 × 585**. Loads this light sit near Apple Silicon's timing floor, so differences under about half a millisecond are noise; nothing has been measured on an integrated GPU or a phone, where the tier budgets are set.

The time is the village (story 4.2: about 1.2 ms at 1080p with the tail), plus the depth lens (5.1: about 0.6 to 0.8 ms), plus a full-resolution sharp copy of the scene the lens reads from (16.6 MB at 1080p), plus the grade and finishing pass (one more full-resolution pass and a 16.6 MB display target). The choreography is a few dozen arithmetic operations a frame.

## Pitfalls

- **Wheel events are taken from the page** with **scroll** chosen, because the handler must call `preventDefault`. A real page drives the progress from its own scroll and should not listen to the wheel at all.
- **The hero's copy sits over the scene.** The gallery's Hero layout puts it on its own plate; without one, the busy pixel art needs a scrim behind the text.
- **The analyser rates it `low`, not `none`:** the moving camera carries edges across its cells, one transition a second in one cell at most. Nothing flashes over a large area.
- **Close shots show the edge of the diorama** against the background colour; a scene meant for this needs ground beyond what the camera visits.

## When to use it

A landing page told in a few sections, each with one thing to look at, where the scene moving with the story is the point. Tier B provisionally: the diorama and the depth lens. Where that is too much, the screen lens is the step down, and the parallax header (story 9.4) is the Tier A route to the look.

## References

- The tilt-shift and rack-focus language of HD-2D games: Acquire and Square Enix, _The Fusion of Nostalgia and Novelty in the Development of Octopath Traveler_ (Unreal Fest Europe 2019).
- Scroll-driven animation on the web: <https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_scroll-driven_animations>
