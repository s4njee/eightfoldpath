import { injectStyle, placeAt, watchMotion } from '../../gpu/ui/overlay.ts';
import { handSvg } from './cursor.ts';
import { cursorRect, moveCursor, type MenuLayout, type Rect } from './layout.ts';
import { MENU_CSS, MENU_STYLE_ID } from './style.ts';

/*
 * The menu windows' HTML (story 9.6). The commands are real buttons in an ARIA menu: one tab stop
 * (a roving tabindex), up and down to move, Home and End, a letter to jump, Enter or Space to
 * choose. The hand follows `active`, which keyboard, pointer and focus all move, so the hand is
 * where the focus is. Choosing writes a line into the message window, a polite live region. The
 * party window is plain text in a labelled group.
 *
 * The hand is HTML too (an SVG of the pixel grid in cursor.ts), not canvas pixels: it has to move
 * the moment a key is pressed, and the canvas is only redrawn while the host's frame loop runs,
 * which it does not under reduced motion. It is placed in whole texels, so it is as crisp as the
 * frame.
 */

export interface Command {
  readonly label: string;
  /** What the message window says when it is chosen. */
  readonly message: string;
  readonly disabled?: boolean;
}

export const COMMANDS: readonly Command[] = [
  { label: 'Items', message: 'Three herbs, a lantern and an old iron key.' },
  { label: 'Skills', message: 'Firstlight: a small flame that shows the way.' },
  { label: 'Equip', message: 'A travelling cloak and an oak staff.' },
  { label: 'Status', message: 'The Traveller is rested and ready to go.' },
  { label: 'Save', message: 'There is no shrine here to rest at.', disabled: true },
];

export const PARTY = { name: 'Traveller', lines: ['Lv 12', 'HP 248 / 260', 'MP 31 / 40'] };
const PROMPT = 'Where to next?';

export type MenuSkin = 'canvas' | 'css';

export interface MenuDom {
  /** The item the hand points at. */
  readonly active: number;
  readonly items: readonly HTMLButtonElement[];
  /** Places every part at the layout's rectangles (canvas skin). */
  place(layout: MenuLayout, texel: number): void;
  /** Puts the CSS skin's hand back beside the active item, after the layout has changed. */
  refresh(): void;
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

/** Builds the three windows inside `root`. `onMove` fires whenever the hand should move. */
export function buildMenu(
  root: HTMLElement,
  options: { skin: MenuSkin; commands?: readonly Command[]; onMove?: (index: number) => void },
): MenuDom {
  const doc = root.ownerDocument;
  injectStyle(doc, MENU_STYLE_ID, MENU_CSS);
  const commands = options.commands ?? COMMANDS;
  const labels = commands.map((command) => command.label);
  const id = `efp-menu-${nextId++}`;

  const commandWindow = el(doc, 'div', 'efp-menu__window efp-menu__window--commands');
  const list = el(doc, 'ul', 'efp-menu__list');
  list.setAttribute('role', 'menu');
  list.setAttribute('aria-label', 'Commands');
  list.setAttribute('aria-orientation', 'vertical');
  const rows = commands.map(() => {
    const row = el(doc, 'li', '');
    row.setAttribute('role', 'none');
    return row;
  });
  const items = commands.map((command, i) => {
    const item = el(doc, 'button', 'efp-menu__item');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    if (command.disabled) item.setAttribute('aria-disabled', 'true');
    item.append(el(doc, 'span', '', command.label));
    rows[i]!.append(item);
    return item;
  });
  list.append(...rows);
  const hand = el(doc, 'span', 'efp-menu__hand');
  hand.setAttribute('aria-hidden', 'true');
  commandWindow.append(list, hand);

  const partyWindow = el(doc, 'div', 'efp-menu__window efp-menu__window--party');
  partyWindow.setAttribute('role', 'group');
  const stats = el(doc, 'div', 'efp-menu__stats');
  const name = el(doc, 'p', 'efp-menu__name', PARTY.name);
  name.id = `${id}-party`;
  partyWindow.setAttribute('aria-labelledby', name.id);
  stats.append(name, ...PARTY.lines.map((line) => el(doc, 'p', '', line)));
  partyWindow.append(stats);

  const messageWindow = el(doc, 'div', 'efp-menu__window efp-menu__window--message');
  const line = el(doc, 'p', 'efp-menu__line', PROMPT);
  line.setAttribute('aria-live', 'polite');
  messageWindow.append(line);
  root.append(commandWindow, partyWindow, messageWindow);

  root.style.setProperty(
    '--efp-menu-hand',
    `url("data:image/svg+xml,${encodeURIComponent(handSvg())}")`,
  );
  let placed: { layout: MenuLayout; texel: number } | undefined;
  let active = 0;
  const setActive = (index: number, focus: boolean) => {
    active = index;
    items.forEach((item, i) => {
      item.tabIndex = i === index ? 0 : -1;
      item.toggleAttribute('data-active', i === index);
    });
    if (focus) items[index]!.focus();
    if (options.skin === 'css') {
      const item = items[index]!;
      hand.style.top = `${item.offsetTop + (item.offsetHeight - hand.offsetHeight) / 2}px`;
    } else if (placed) {
      const [x, y, w, h] = cursorRect(placed.layout, index);
      const [cx, cy] = placed.layout.commands;
      placeAt(hand, [x - cx, y - cy, w, h], placed.texel);
    }
    options.onMove?.(index);
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next = moveCursor(active, event.key, labels);
    if (next === undefined) return;
    event.preventDefault();
    setActive(next, true);
  };
  const onFocus = (event: FocusEvent) => {
    const index = items.indexOf(event.target as HTMLButtonElement);
    if (index >= 0 && index !== active) setActive(index, false);
  };
  const listeners = items.map((item, i) => {
    // Pointing at an item moves the hand there; focus follows only if the menu already has it.
    const enter = () => {
      if (i !== active) setActive(i, list.contains(doc.activeElement));
    };
    const choose = () => {
      setActive(i, false);
      line.textContent = commands[i]!.message;
    };
    item.addEventListener('pointerenter', enter);
    item.addEventListener('click', choose);
    return () => {
      item.removeEventListener('pointerenter', enter);
      item.removeEventListener('click', choose);
    };
  });
  list.addEventListener('keydown', onKey);
  list.addEventListener('focusin', onFocus);
  setActive(0, false);

  return {
    get active() {
      return active;
    },
    items,
    refresh: () => setActive(active, false),
    place(layout, texel) {
      placed = { layout, texel };
      const local = (rect: Rect, origin: Rect): Rect => [
        rect[0] - origin[0],
        rect[1] - origin[1],
        rect[2],
        rect[3],
      ];
      placeAt(commandWindow, layout.commands, texel);
      placeAt(list, [0, 0, layout.commands[2], layout.commands[3]], texel);
      rows.forEach((row, i) => placeAt(row, local(layout.items[i]!, layout.commands), texel));
      placeAt(partyWindow, layout.party, texel);
      placeAt(stats, local(layout.stats, layout.party), texel);
      placeAt(messageWindow, layout.message, texel);
      placeAt(line, local(layout.line, layout.message), texel);
      setActive(active, false);
    },
    destroy() {
      for (const stop of listeners) stop();
      list.removeEventListener('keydown', onKey);
      list.removeEventListener('focusin', onFocus);
      commandWindow.remove();
      partyWindow.remove();
      messageWindow.remove();
    },
  };
}

/**
 * The CSS-only menu windows (story 12.5), for a page without WebGPU: the same buttons, keys and
 * messages, with the border as a `border-image`, the glass as a `backdrop-filter` over whatever
 * the page draws behind it, and the hand as an SVG. Fills `container`, which should be positioned.
 */
export function mountCssMenu(
  container: HTMLElement,
  options: { frameUrl: string; commands?: readonly Command[]; texel?: number },
): { readonly element: HTMLElement; destroy(): void } {
  const doc = container.ownerDocument;
  const root = el(doc, 'div', 'efp-menu efp-menu--css');
  root.style.setProperty('--efp-menu-frame', `url("${options.frameUrl}")`);
  if (options.texel) root.style.setProperty('--efp-texel', `${options.texel}px`);
  container.append(root);
  const menu = buildMenu(root, { skin: 'css', commands: options.commands });
  const motion = watchMotion(container, (animate) => root.toggleAttribute('data-animate', animate));
  root.toggleAttribute('data-animate', motion.animate);
  // The hand is placed from the laid-out buttons, so place it again whenever their layout changes.
  const View = doc.defaultView?.ResizeObserver;
  const observer = View ? new View(() => menu.refresh()) : undefined;
  observer?.observe(root);
  return {
    element: root,
    destroy() {
      observer?.disconnect();
      motion.stop();
      menu.destroy();
      root.remove();
    },
  };
}
