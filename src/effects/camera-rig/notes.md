## How it works

The rig (`src/gpu/diorama/rig.ts`) is the plan's camera, narrow (25°) and pitched down (35°), with every way a page might move it kept as plain state and arithmetic, so it has no DOM of its own and can be driven by anything. It holds two poses: the **target**, which input changes, and the **pose** the camera is actually at, which follows the target with an exponential ease (a quarter of a second by default). Input never jolts the view, and a still frame can jump straight to the target with `settle()`.

- **Pan** moves the focus along the ground in the camera's own terms, right and away, clamped to the scene. A drag across the canvas moves it by the height the camera sees at the focus, so the ground stays under the pointer.
- **Dolly** multiplies the distance, eased in proportion so moving in and moving out feel alike, within a range around the scene's own distance.
- **Pointer parallax** leans the camera a few degrees toward the pointer. It rides on top of the target rather than moving it, so it springs back when the pointer leaves.
- **Paths** are a list of poses at positions from 0 to 1. The focus follows a Catmull–Rom curve through them, so a tour through several places is smooth; the angles, distance and field of view ease between neighbouring poses, so the camera settles on each one rather than swinging past it. The effect's tour has four poses: the overview, the plaza, the stairs and the shore.
- **Driven by time or by scrolling.** By time, the tour goes there and back. By scrolling, `scrollProgress` measures how far the canvas has travelled through the viewport (0 as its top enters, 1 as its bottom leaves), which is what a landing page wants; the gallery's effect page does not scroll, so there the wheel over the canvas stands in.
- **Orthographic** frames the same height at the focus as perspective does, so switching between them keeps the subject the same size; only the depth cue changes. Nothing shrinks with distance, the back terrace looks as close as the front and the diorama reads as a model or a map.

The village and its lighting are the `diorama` effect's stage (`src/gpu/diorama/stage.ts`).

## Cost

The rig is a few dozen arithmetic operations a frame on the CPU. The picture costs what `diorama` costs: 1.16 ms at 1920 × 1080 and 0.59 ms at 1266 × 585 on an Apple M1 Max ([docs/studies/epic-4.md](../../../docs/studies/epic-4.md)), the same in orthographic and along the tour.

## Pitfalls

- **Wheel events are taken from the page** while the pointer is over the canvas (dolly, or advancing the tour), because the handler must call `preventDefault`. On a page that scrolls past a full-width canvas, drive the path from `scrollProgress` instead and leave the wheel alone.
- **Upright sprites are cards.** The tour keeps the yaw within about ±0.9 radians: past a quarter turn the sprites, which turn to face the camera, start to look like the flat cards they are.
- **Orthographic hides the dolly.** Moving the camera back changes nothing in orthographic projection except the near and far planes; the framing comes from the distance, so the rig scales it with the distance to keep the dolly working.
- **Easing hides the frame rate but not a stall.** After a long pause the clamped frame delta moves the camera most of the way at once.

## When to use it

Any diorama a visitor can look around, and a scroll-told landing page (story 9.1 builds on it). Pointer parallax alone is the cheapest way to make a still diorama feel three-dimensional. Tier B with the village behind it; the rig itself costs nothing.

## References

- E. Catmull and R. Rom, _A Class of Local Interpolating Splines_ (1974).
- The orthographic-against-perspective comparison in the HD-2D talk: Acquire and Square Enix, _The Fusion of Nostalgia and Novelty in the Development of Octopath Traveler_ (Unreal Fest Europe 2019).
