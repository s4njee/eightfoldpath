import { motionAllowed, onMotionChange } from '../../shell/motion.ts';

/*
 * DOM over an effect's own canvas (stories 9.5 and 9.6): the interface parts of a game-style
 * window that have to be real HTML (text a screen reader can read, buttons a keyboard can reach)
 * laid over the pixels the effect draws for the same window.
 *
 *   const overlay = createCanvasOverlay(canvas, { className: 'my-ui', styleId: 'my-ui', css });
 *   if (overlay) overlay.root.append(...);   // undefined without a DOM: draw the canvas alone
 *   resize()  { overlay?.fit(); const css = texelCss(scale, overlay?.pixelRatio() ?? 1); ... }
 *   destroy() { overlay?.destroy(); }
 *
 * The effect contract hands an effect a canvas and nothing else, so the overlay goes into the
 * canvas's parent, sized and placed over the canvas's box. Both effects lay the window out in
 * texels, place the DOM from that layout in CSS pixels, and draw the frame from the same numbers,
 * so the two can never disagree by more than the rounding of one CSS pixel.
 *
 * A canvas inside a link, an `aria-hidden` or an `inert` subtree is decoration (a gallery
 * thumbnail is all three): its overlay is made inert too, so a card does not grow buttons that a
 * keyboard can reach but a screen reader is told are not there.
 */

export interface OverlayOptions {
  /** Class of the overlay's root element. */
  className: string;
  /** A stylesheet, added to the document once under this id. */
  styleId: string;
  css: string;
}

export interface CanvasOverlay {
  readonly root: HTMLElement;
  /** True when the canvas is decoration and the overlay is inert. */
  readonly decorative: boolean;
  /** Canvas pixels per CSS pixel: the drawing buffer's width over the laid-out width. */
  pixelRatio(): number;
  /**
   * Places the overlay over the canvas's box and shows it; call it from `resize`, then place the
   * overlay's contents in the same task so nothing is painted half laid out.
   */
  fit(): void;
  destroy(): void;
}

/** Adds `css` to a document under `id`, once however many effects ask for it. */
export function injectStyle(doc: Document, id: string, css: string): void {
  if (doc.getElementById(id)) return;
  const style = doc.createElement('style');
  style.id = id;
  style.textContent = css;
  doc.head.append(style);
}

/** True for a canvas that is decoration: inside a link, an aria-hidden or an inert subtree. */
export function isDecorative(canvas: HTMLCanvasElement): boolean {
  return (
    typeof canvas.closest === 'function' && !!canvas.closest('a, [aria-hidden="true"], [inert]')
  );
}

/** The overlay for `canvas`, or undefined when there is no DOM (tests, workers, a stub canvas). */
export function createCanvasOverlay(
  canvas: HTMLCanvasElement,
  options: OverlayOptions,
): CanvasOverlay | undefined {
  const parent = canvas.parentElement;
  const doc = canvas.ownerDocument;
  if (!parent || !doc || typeof doc.createElement !== 'function') return undefined;
  injectStyle(doc, options.styleId, options.css);

  // The overlay is placed relative to the parent, so the parent has to be positioned. Only a
  // static parent is changed, and it is put back on destroy.
  const view = doc.defaultView;
  const restorePosition =
    view?.getComputedStyle(parent).position === 'static' ? parent.style.position : undefined;
  if (restorePosition !== undefined) parent.style.position = 'relative';

  const root = doc.createElement('div');
  root.className = options.className;
  // Hidden until the first `fit`, so the unplaced DOM never shows while the effect loads.
  Object.assign(root.style, { position: 'absolute', pointerEvents: 'none', visibility: 'hidden' });
  const decorative = isDecorative(canvas);
  if (decorative) {
    root.inert = true;
    root.setAttribute('aria-hidden', 'true');
  }
  parent.append(root);

  const fit = () => {
    Object.assign(root.style, {
      left: `${canvas.offsetLeft}px`,
      top: `${canvas.offsetTop}px`,
      width: `${canvas.offsetWidth}px`,
      height: `${canvas.offsetHeight}px`,
      visibility: '',
    });
  };

  return {
    root,
    decorative,
    pixelRatio: () => (canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1),
    fit,
    destroy() {
      root.remove();
      if (restorePosition !== undefined) parent.style.position = restorePosition;
    },
  };
}

/**
 * Pixels per texel for interface art over a canvas: about three CSS pixels a texel on a wide canvas
 * and two on a narrow one, always a whole number of canvas pixels so every texel is the same size,
 * and smaller when the canvas would otherwise be under `minTexels` across.
 */
export function fitTexelScale(width: number, pixelRatio: number, minTexels = 160): number {
  const cssWidth = width / Math.max(pixelRatio, 1e-3);
  const target = cssWidth >= 720 ? 3 : 2;
  let scale = Math.max(1, Math.round(target * pixelRatio));
  while (scale > 1 && width / scale < minTexels) scale--;
  return scale;
}

/** CSS pixels per texel, for placing DOM over art drawn at `scale` canvas pixels a texel. */
export function texelCss(scale: number, pixelRatio: number): number {
  return scale / Math.max(pixelRatio, 1e-3);
}

/** Positions an element at a rectangle given in texels. */
export function placeAt(
  element: HTMLElement,
  rect: readonly [number, number, number, number],
  texel: number,
): void {
  Object.assign(element.style, {
    position: 'absolute',
    left: `${rect[0] * texel}px`,
    top: `${rect[1] * texel}px`,
    width: `${rect[2] * texel}px`,
    height: `${rect[3] * texel}px`,
  });
}

/**
 * Whether the effect may animate, following the gallery's motion choice and the system's
 * `prefers-reduced-motion`, and calling `changed` when that changes. Without a window it allows
 * motion and never calls back. The host stops the frame loop under reduced motion anyway; an
 * effect with DOM needs this too, because its DOM must not be left half-way through a reveal.
 */
export function watchMotion(
  element: Element,
  changed: (animate: boolean) => void,
): { readonly animate: boolean; stop(): void } {
  const media = element.ownerDocument?.defaultView?.matchMedia?.(
    '(prefers-reduced-motion: reduce)',
  );
  let animate = motionAllowed(media?.matches ?? false);
  const update = () => {
    const next = motionAllowed(media?.matches ?? false);
    if (next === animate) return;
    animate = next;
    changed(animate);
  };
  media?.addEventListener('change', update);
  const stopChoice = media ? onMotionChange(update) : () => {};
  return {
    get animate() {
      return animate;
    },
    stop() {
      media?.removeEventListener('change', update);
      stopChoice();
    },
  };
}
