/*
 * The menu windows' stylesheet (story 9.6), a string the effect adds to its canvas's document.
 *
 * `--canvas`: the GPU draws the glass, frames and portrait; the DOM holds the buttons, the text and
 * the hand, placed by the effect from the texel layout. `--css`: the fallback for a page without
 * WebGPU (story 12.5), with the border as a `border-image` (its middle left out), the glass as a
 * `backdrop-filter` over whatever the page has behind the menu, and the hand as an SVG image.
 *
 * Custom properties a page can set:
 *   --efp-menu-font      the `font` shorthand
 *   --efp-menu-ink       text colour (light: the glass is dark)
 *   --efp-menu-active    the item under the cursor
 *   --efp-menu-glass     the CSS skin's glass colour
 */

export const MENU_STYLE_ID = 'efp-menu-style';

export const MENU_CSS = `
.efp-menu {
  --efp-texel: 3px;
  color: var(--efp-menu-ink, #eee6c9);
  font: var(--efp-menu-font, 600 max(14px, calc(var(--efp-texel) * 6)) / 1 ui-serif, Georgia, 'Times New Roman', serif);
  text-shadow: calc(var(--efp-texel) * 0.5) calc(var(--efp-texel) * 0.5) 0 #131220;
}
.efp-menu__window,
.efp-menu__list,
.efp-menu__stats,
.efp-menu__line {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}
.efp-menu__window {
  pointer-events: auto;
}
.efp-menu__list {
  list-style: none;
}
.efp-menu__item {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: start;
  text-shadow: inherit;
  cursor: pointer;
}
.efp-menu__item[data-active] {
  color: var(--efp-menu-active, #fad719);
}
.efp-menu__item[aria-disabled='true'] {
  color: #a9bbbf;
}
.efp-menu__item:focus {
  outline: none;
}
/* The hand marks the active item; while the menu has keyboard focus it gets an underline too, so
   focus is never shown by the canvas alone. */
.efp-menu__item:focus-visible > span {
  text-decoration: underline;
  text-decoration-thickness: max(2px, calc(var(--efp-texel) * 0.67));
  text-underline-offset: calc(var(--efp-texel) * 1.5);
}
.efp-menu__stats {
  display: grid;
  grid-auto-rows: calc(var(--efp-texel) * 13);
  align-items: center;
}
.efp-menu__stats > * {
  margin: 0;
  overflow: hidden;
  white-space: nowrap;
}
.efp-menu__stats .efp-menu__name {
  color: var(--efp-menu-active, #fad719);
}
.efp-menu__line {
  display: flex;
  align-items: center;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.efp-menu__hand {
  position: absolute;
  background: var(--efp-menu-hand) no-repeat center / 100% 100%;
  pointer-events: none;
}
.efp-menu[data-no-cursor] .efp-menu__hand {
  display: none;
}
.efp-menu[data-animate] .efp-menu__hand {
  animation: efp-menu-nudge 0.5s steps(1, end) infinite;
}
@keyframes efp-menu-nudge {
  50% { translate: var(--efp-texel) 0; }
}

/* The CSS skin: laid out by CSS, the glass from backdrop-filter. */
.efp-menu--css {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template: 'commands party' auto 'gap gap' 1fr 'message message' auto / auto 1fr;
  gap: calc(var(--efp-texel) * 6);
  padding: calc(var(--efp-texel) * 8);
  pointer-events: none;
}
.efp-menu--css .efp-menu__window {
  position: relative;
  padding: calc(var(--efp-texel) * 3);
  border: solid transparent;
  border-width: calc(var(--efp-texel) * 6) calc(var(--efp-texel) * 7);
  border-image: var(--efp-menu-frame) 6 7 / calc(var(--efp-texel) * 6) calc(var(--efp-texel) * 7) /
    0 repeat;
  background: var(--efp-menu-glass, rgb(19 18 32 / 0.62));
  background-clip: padding-box;
  -webkit-backdrop-filter: blur(calc(var(--efp-texel) * 3)) brightness(0.8);
  backdrop-filter: blur(calc(var(--efp-texel) * 3)) brightness(0.8);
  image-rendering: pixelated;
}
.efp-menu--css .efp-menu__window--commands { grid-area: commands; }
.efp-menu--css .efp-menu__window--party { grid-area: party; max-width: calc(var(--efp-texel) * 200); }
.efp-menu--css .efp-menu__window--message { grid-area: message; }
.efp-menu--css .efp-menu__list li {
  height: calc(var(--efp-texel) * 13);
  padding-left: calc(var(--efp-texel) * 18);
}
.efp-menu--css .efp-menu__line {
  height: calc(var(--efp-texel) * 13);
}
.efp-menu--css .efp-menu__hand {
  top: 0;
  left: calc(var(--efp-texel) * 3);
  width: calc(var(--efp-texel) * 16);
  height: calc(var(--efp-texel) * 12);
}
@media (max-width: 520px) {
  .efp-menu--css {
    --efp-texel: 2px;
    grid-template: 'commands' auto 'party' auto 'gap' 1fr 'message' auto / 1fr;
  }
}
@media (prefers-reduced-motion: reduce) {
  .efp-menu__hand { animation: none !important; }
}
`;
