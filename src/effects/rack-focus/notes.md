## How it works

A rack focus pulls the sharp plane from one subject to another while the camera holds still, as a focus puller does on a film set: the eye follows the focus. In a tilt-shift diorama it moves the reader from one figure to the next without moving the camera at all. This effect drives the tilt-shift lens's focus (story 5.1) between five figures in the village, far, near and in between, with a traveller added on the back terrace so there is someone far away.

The driver is `src/gpu/lens/rack-focus.ts`, plain state and arithmetic with no DOM and no GPU, so any page or effect can drive any lens distance with it:

- **`createRackFocus({ duration })`** holds the focus distance. `rackTo(distance, key)` says where it is heading: a new key (a subject's index) starts a rack of `duration` seconds from where the focus is now, the same key only moves the end, so a subject or a camera that moves is followed without restarting the rack. `update(dt, reducedMotion)` advances it and returns the distance.
- **The rack is a cubic Hermite curve** from the current distance and speed to the target at rest. From rest that is a smoothstep: slow off the mark, fastest half-way, settling on the subject. Retargeted half-way, it keeps the speed it had rather than stopping dead, so a visitor clicking from one figure to another never sees the focus jerk.
- **Choosing the subject** is three small functions that return an index: `scheduledSubject(time, count, hold)` takes each in turn for `hold` seconds, looping; `scrolledSubject(progress, count)` splits a scroll progress (the rig's `scrollProgress`) evenly among them; `pickSubject(camera, points, pointer, size, radius)` projects each subject's middle through the camera and takes the one drawn nearest the pointer. `viewDistance` in the lens module turns the chosen subject's middle into a focus distance along the view axis.

The effect takes the target every frame from the chosen figure's middle (its feet plus half its height), so the focus lands on the figure rather than the ground under it, and hands the eased distance to the lens as `focusDistance`. Three drives: **time** (a schedule, three seconds a figure), **scroll** (the page's scroll when the canvas moves through the viewport, the wheel over the canvas when it does not, as in `camera-rig`) and **click** (a press over a figure focuses on it).

The view is the lens's **circle of confusion**, where the sharp band can be seen sweeping through the scene. The stages are the rack focus (off: a fixed focus at the `fixed focus` setting), the depth of field and the lanterns' glow.

## Cost

**Study** (`npm run study -- --epic 5`, [docs/studies/epic-5.md](../../../docs/studies/epic-5.md), Apple M1 Max on Dawn, marginal cost per frame with the tail, at the defaults): **1.7 ms at 1920 × 1080 and 1.1 ms at 1266 × 585**. Loads this light sit near Apple Silicon's timing floor, so differences under about half a millisecond are noise; nothing has been measured on an integrated GPU or a phone, where the tier budgets are set.

The driver costs nothing measurable: a few multiplications a frame on the CPU. The effect costs what `tilt-shift` does, since the lens reads its settings at encode time and racking changes no pipeline or target: measured once on an Apple M1 Max on Dawn with other agents using the GPU, so indicative only, about **1.3 ms** a frame at 1920 × 1080 and 0.7 ms at 1266 × 585 (the slope method of `tests/bench.ts`, not `npm run study`). Nothing has been measured on an integrated GPU or in Chrome, and the bundle size has not been measured yet. The blur's size changes as the band sweeps through the scene, which the gather's cost barely notices (`tilt-shift`'s notes).

## Pitfalls

- **Reduced motion.** A rack is motion, so under `prefers-reduced-motion` (or the `reduced motion` setting) the schedule stops on the first figure and scrolling or clicking jumps the focus instead of racking it. The gallery also pauses the loop under reduced motion, so there it holds still regardless.
- **Upright sprites span depth.** A figure four units tall spans about 2.3 units of view depth at 35°, so the target is its middle and the default band is 3 units, a little deeper than a figure: a thinner band racks to a figure with its head or feet still soft.
- **Focusing on a key, not a number.** Passing a fresh distance each frame without a key would start a new rack every frame as the camera moves, which crawls; the key says it is still the same subject.
- **Picking is by the subject's middle on screen**, within a radius (an eighth of the canvas height here), not by its silhouette: a click on a tall figure's head can miss, and a click between two figures takes the nearer middle. For anything that is not in a list, read the depth under the pointer and use the lens's own linearisation instead.
- **Scroll by steps.** The scroll drive splits the page evenly among the figures, so the focus racks once per step rather than scrubbing continuously; that suits a scroll story with a figure per section, not a slider.

## When to use it

Wherever the depth lens already runs (Tier B, provisional): a hero that moves the reader's eye from figure to figure, a scroll story with a subject per section, a diorama that answers a click by focusing on what was clicked. On the screen lens the same driver can animate `line` instead. Without a lens, or under reduced motion, a fixed focus is the fallback and costs nothing.

## References

- Epic Games, _Depth of Field_ in the Unreal Engine 4 documentation: the focal distance as an animatable setting, and the focal region (recalled, not yet checked).
- The cubic Hermite spline, for a rack that starts from the current speed and ends at rest (any numerical analysis text).
- This project's `tilt-shift` notes and `src/gpu/diorama/rig.ts`: the lens, `viewDistance` and `scrollProgress`.
