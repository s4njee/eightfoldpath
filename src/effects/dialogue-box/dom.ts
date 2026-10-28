import { injectStyle, placeAt, watchMotion } from '../../gpu/ui/overlay.ts';
import type { DialogueLayout, Rect } from './layout.ts';
import { createDialogueState, type DialogueSettings } from './reveal.ts';
import { DIALOGUE_CSS, DIALOGUE_STYLE_ID, PENDING_HIGHLIGHT } from './style.ts';

/*
 * The dialogue box's HTML (story 9.5): what a screen reader, a keyboard and a translator meet.
 *
 * The whole line is in the DOM from the start, as one text node in a polite live region, and the
 * typewriter only hides the part not yet reached, with a CSS Custom Highlight that makes it
 * transparent. Nothing is inserted character by character, so assistive technology hears each line
 * once and whole when the page turns, selection and find-in-page work on the full line, the text
 * never reflows while it types (the hidden part already takes its room), and a translated page
 * keeps working. A browser without the Highlight API shows every line whole.
 *
 * Advancing is one real button (Enter and Space come with it) plus a click anywhere on the window;
 * a click that ends a text selection does not count.
 */

export type DialogueSkin = 'canvas' | 'css';

export interface DialogueDomOptions {
  speaker: string;
  pages: readonly string[];
  skin: DialogueSkin;
  /** For the CSS skin: the window frame image (assets/ui/window-frame.png) and the portrait. */
  frameUrl?: string;
  portraitUrl?: string;
  /** Called on a click on the window, or Enter or Space on the button. */
  onAdvance(): void;
}

export interface DialogueDom {
  /** The window element, `role="group"`, named by the speaker. */
  readonly window: HTMLElement;
  /** The live line. */
  readonly line: HTMLElement;
  readonly button: HTMLButtonElement;
  /** False where the Highlight API is missing: lines are then shown whole. */
  readonly canReveal: boolean;
  /** Puts page `index` in the live line (announced politely when it changes). */
  showPage(index: number): void;
  /** Hides all but the first `length` UTF-16 code units of the line. */
  reveal(length: number, complete: boolean, last: boolean): void;
  /** Height of the text block (the tallest page), in CSS pixels, once `width` is applied. */
  measureText(width: number): number;
  /** Places every part at the layout's rectangles (canvas skin). */
  place(layout: DialogueLayout, texel: number): void;
  destroy(): void;
}

let nextId = 0;

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** One shared highlight per document; each box adds and removes its own range. */
function pendingHighlight(doc: Document): Highlight | undefined {
  const view = doc.defaultView as (Window & typeof globalThis) | null;
  const registry = view?.CSS?.highlights;
  if (!registry || typeof view.Highlight !== 'function') return undefined;
  let highlight = registry.get(PENDING_HIGHLIGHT);
  if (!highlight) {
    highlight = new view.Highlight();
    registry.set(PENDING_HIGHLIGHT, highlight);
  }
  return highlight;
}

/** Builds the box inside `root` (the overlay, or the fallback's container element). */
export function buildDialogue(root: HTMLElement, options: DialogueDomOptions): DialogueDom {
  const doc = root.ownerDocument;
  injectStyle(doc, DIALOGUE_STYLE_ID, DIALOGUE_CSS);
  const id = `efp-dialogue-${nextId++}`;

  const box = el(doc, 'div', 'efp-dialogue__window');
  box.setAttribute('role', 'group');
  const speaker = el(doc, 'p', 'efp-dialogue__speaker', options.speaker);
  speaker.id = `${id}-speaker`;
  box.setAttribute('aria-labelledby', speaker.id);

  const text = el(doc, 'div', 'efp-dialogue__text');
  const line = el(doc, 'p', 'efp-dialogue__line');
  line.setAttribute('aria-live', 'polite');
  line.setAttribute('aria-atomic', 'true');
  const sizer = el(doc, 'div', 'efp-dialogue__sizer');
  sizer.setAttribute('aria-hidden', 'true');
  sizer.append(...options.pages.map((page) => el(doc, 'span', '', page)));
  text.append(sizer, line);

  const button = el(doc, 'button', 'efp-dialogue__next');
  button.type = 'button';
  const glyph = el(doc, 'span', '', '▼');
  glyph.setAttribute('aria-hidden', 'true');
  button.append(glyph);

  const body = el(doc, 'div', 'efp-dialogue__body');
  body.append(speaker, text);
  if (options.skin === 'css' && options.portraitUrl) {
    const portrait = el(doc, 'img', 'efp-dialogue__portrait');
    portrait.src = options.portraitUrl;
    portrait.alt = '';
    box.append(portrait);
  }
  box.append(body, button);
  root.append(box);
  if (options.skin === 'css' && options.frameUrl) {
    root.style.setProperty('--efp-dialogue-frame', `url("${options.frameUrl}")`);
  }

  const highlight = pendingHighlight(doc);
  const range = doc.createRange();
  highlight?.add(range);

  const onClick = () => {
    // Releasing a drag that selected text is not a request to move on.
    const selection = doc.getSelection();
    if (selection && !selection.isCollapsed && box.contains(selection.anchorNode)) return;
    options.onAdvance();
  };
  box.addEventListener('click', onClick);

  let shown = -1;
  let length = -1;
  return {
    window: box,
    line,
    button,
    canReveal: highlight !== undefined,
    showPage(index) {
      if (index === shown) return;
      shown = index;
      length = -1;
      line.textContent = options.pages[index] ?? '';
    },
    reveal(revealed, complete, last) {
      button.setAttribute(
        'aria-label',
        !complete ? 'Show the whole line' : last ? 'Back to the first line' : 'Next line',
      );
      box.toggleAttribute('data-complete', complete);
      if (revealed === length) return;
      length = revealed;
      const node = line.firstChild;
      if (!node) return;
      const end = node.textContent?.length ?? 0;
      range.setStart(node, Math.min(revealed, end));
      range.setEnd(node, end);
    },
    measureText(width) {
      // Its own height, not the one the last layout gave it.
      text.style.width = `${width}px`;
      text.style.height = '';
      return text.getBoundingClientRect().height;
    },
    place(layout, texel) {
      const [wx, wy] = layout.window;
      const local = (rect: Rect): Rect => [rect[0] - wx, rect[1] - wy, rect[2], rect[3]];
      placeAt(box, layout.window, texel);
      placeAt(speaker, local(layout.speaker), texel);
      placeAt(text, local(layout.text), texel);
      placeAt(button, local(layout.button), texel);
    },
    destroy() {
      box.removeEventListener('click', onClick);
      highlight?.delete(range);
      box.remove();
    },
  };
}

export interface CssDialogueOptions {
  speaker: string;
  pages: readonly string[];
  /** The window frame, e.g. the URL of assets/ui/window-frame.png. */
  frameUrl: string;
  /** The speaker's portrait, e.g. assets/ui/traveller-bust.png. Optional. */
  portraitUrl?: string;
  /** Characters a second. Default 24. */
  speed?: number;
  /** Seconds before a finished page turns by itself; 0 (the default) waits for the reader. */
  hold?: number;
  /** CSS pixels per texel of the frame. Default 3 (2 on narrow screens, from the stylesheet). */
  texel?: number;
}

/**
 * The CSS-only dialogue box (story 12.5), for a page where WebGPU is not available: the same HTML,
 * reveal and keyboard handling as the effect, with the frame as a `border-image`, the portrait as
 * an image and the marker as a glyph. It sits along the bottom of `container`, which should be
 * positioned. It runs its own animation frames, and none at all under reduced motion.
 */
export function mountCssDialogue(
  container: HTMLElement,
  options: CssDialogueOptions,
): { readonly element: HTMLElement; destroy(): void } {
  const doc = container.ownerDocument;
  const root = el(doc, 'div', 'efp-dialogue efp-dialogue--css');
  if (options.texel) root.style.setProperty('--efp-texel', `${options.texel}px`);
  container.append(root);
  const state = createDialogueState(options.pages);
  const settings = (): DialogueSettings => ({
    speed: options.speed ?? 24,
    hold: options.hold ?? 0,
    animate: motion.animate && dom.canReveal,
  });
  const dom = buildDialogue(root, {
    ...options,
    skin: 'css',
    onAdvance() {
      state.advance(settings());
      sync();
    },
  });
  const sync = () => {
    const now = settings();
    root.toggleAttribute('data-animate', now.animate);
    dom.showPage(state.page);
    dom.reveal(state.revealed(now), state.complete(now), state.page === options.pages.length - 1);
  };

  let frame = 0;
  let last: number | undefined;
  const view = doc.defaultView;
  const tick = (now: number) => {
    state.tick(last === undefined ? 0 : Math.min(0.1, (now - last) / 1000), settings());
    last = now;
    sync();
    frame = view?.requestAnimationFrame(tick) ?? 0;
  };
  const start = () => {
    view?.cancelAnimationFrame(frame);
    last = undefined;
    sync();
    if (settings().animate) frame = view?.requestAnimationFrame(tick) ?? 0;
  };
  // Reads `dom` lazily: it exists by the time a change can arrive.
  const motion = watchMotion(container, start);
  start();

  return {
    element: root,
    destroy() {
      view?.cancelAnimationFrame(frame);
      motion.stop();
      dom.destroy();
      root.remove();
    },
  };
}
