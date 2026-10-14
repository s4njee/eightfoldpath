// The layer inspector (story 2.2), the before/after split (2.3) and the texel loupe (2.4).
//
// The panel offers exactly what the effect declares in `inspect`: a view picker and a switch per
// stage. The split and the loupe are drawn over the canvas by the shell: the split asks the host
// to render the frame a second time with every stage off and copies the left part over the
// canvas; the loupe magnifies the canvas under the pointer, one block per canvas pixel.
import type { InspectSpec } from '../effects/types.ts';
import { readInspect, writeInspect, type InspectChoice, DEFAULT_SPLIT } from './inspect-url.ts';
import type { EffectHost } from './host.ts';
import { onQueryChange, readQuery, updateQuery } from './router.ts';
import type { Unmount } from './types.ts';
import './inspector.css';

/** Loupe size in CSS pixels, and loupe pixels per canvas pixel. */
const LOUPE_SIZE = 176;
const LOUPE_ZOOM = 8;

const VIEW_LABELS: Readonly<Record<string, string>> = {
  final: 'Final picture',
  scene: 'Before post-processing',
  bloom: 'Bloom alone',
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function toggle(label: string, title: string): HTMLButtonElement {
  const node = el('button', 'efp-button', label);
  node.type = 'button';
  node.title = title;
  return node;
}

export function mountInspector(
  container: HTMLElement,
  host: EffectHost,
  spec: InspectSpec = {},
): Unmount {
  const views = ['final', ...(spec.views ?? [])];
  const stages = spec.stages ?? [];
  let choice: InspectChoice = readInspect(readQuery(), spec);

  // --- Panel ------------------------------------------------------------------------------
  const root = el('section', 'efp-inspector');
  root.setAttribute('aria-labelledby', 'efp-inspector-title');
  const title = el('h2', 'efp-label', 'Inspect');
  title.id = 'efp-inspector-title';
  root.append(title);

  let viewSelect: HTMLSelectElement | undefined;
  if (views.length > 1) {
    const field = el('label', 'efp-inspector__field');
    field.append(el('span', 'efp-muted', 'View'));
    viewSelect = el('select', 'efp-controls__select');
    for (const view of views) {
      const option = el('option', '', VIEW_LABELS[view] ?? view[0]!.toUpperCase() + view.slice(1));
      option.value = view;
      viewSelect.append(option);
    }
    viewSelect.addEventListener('change', () =>
      updateQuery(writeInspect({ view: viewSelect!.value }), { replace: true }),
    );
    field.append(viewSelect);
    root.append(field);
  }

  const stageButtons = new Map<string, HTMLButtonElement>();
  if (stages.length) {
    const group = el('div', 'efp-inspector__stages');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Stages');
    for (const stage of stages) {
      const node = toggle(stage, `Switch ${stage} on or off`);
      node.addEventListener('click', () => {
        const off = choice.off.includes(stage)
          ? choice.off.filter((name) => name !== stage)
          : [...choice.off, stage];
        updateQuery(writeInspect({ off }), { replace: true });
      });
      stageButtons.set(stage, node);
      group.append(node);
    }
    root.append(el('span', 'efp-muted', 'Stages'), group);
  }

  const tools = el('div', 'efp-inspector__tools');
  const splitButton = toggle(
    'Before / after',
    'Every stage off on the left, the finished picture on the right. Draws each frame twice.',
  );
  splitButton.hidden = stages.length === 0;
  splitButton.addEventListener('click', () =>
    updateQuery(writeInspect({ split: choice.split === undefined ? DEFAULT_SPLIT : undefined }), {
      replace: true,
    }),
  );
  const loupeButton = toggle(
    'Loupe',
    'Magnify the canvas under the pointer to check texels, sampling and shimmer.',
  );
  loupeButton.addEventListener('click', () =>
    updateQuery(writeInspect({ loupe: !choice.loupe }), { replace: true }),
  );
  tools.append(splitButton, loupeButton);
  root.append(tools);
  container.append(root);

  // --- Before/after split overlay -------------------------------------------------------------
  const split = el('div', 'efp-split');
  const handle = el('button', 'efp-split__handle');
  handle.type = 'button';
  handle.setAttribute('aria-label', 'Move the before/after split');
  split.append(
    el('span', 'efp-split__label efp-split__label--before', 'Before'),
    el('span', 'efp-split__label efp-split__label--after', 'After'),
    handle,
  );
  host.element.append(split);
  let dragging = false;
  const positionAt = (clientX: number) => {
    const rect = host.element.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };
  const showSplit = (position: number) => {
    split.style.setProperty('--efp-split', `${position * 100}%`);
    host.setSplit(position);
  };
  handle.addEventListener('pointerdown', (event) => {
    dragging = true;
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', (event) => {
    if (dragging) showSplit(positionAt(event.clientX));
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    updateQuery(writeInspect({ split: host.split }), { replace: true });
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
  handle.addEventListener('keydown', (event) => {
    const step = event.key === 'ArrowLeft' ? -0.05 : event.key === 'ArrowRight' ? 0.05 : 0;
    if (!step || host.split === undefined) return;
    event.preventDefault();
    updateQuery(writeInspect({ split: Math.min(1, Math.max(0, host.split + step)) }), {
      replace: true,
    });
  });

  // --- Texel loupe ----------------------------------------------------------------------------
  const loupe = el('canvas', 'efp-loupe');
  loupe.setAttribute('aria-hidden', 'true');
  host.element.append(loupe);
  let pointer: { x: number; y: number } | undefined;
  const drawLoupe = () => {
    if (!choice.loupe || !pointer) return;
    const dpr = window.devicePixelRatio || 1;
    const size = Math.round(LOUPE_SIZE * dpr);
    if (loupe.width !== size) loupe.width = loupe.height = size;
    const context = loupe.getContext('2d');
    if (!context) return;
    const rect = host.canvas.getBoundingClientRect();
    const scale = host.canvas.width / rect.width;
    const shown = size / LOUPE_ZOOM;
    const cx = Math.floor((pointer.x - rect.left) * scale - shown / 2);
    const cy = Math.floor((pointer.y - rect.top) * scale - shown / 2);
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, size, size);
    context.drawImage(host.canvas, cx, cy, shown, shown, 0, 0, size, size);
    // One cell per canvas pixel: art texels show up as blocks of cells that share a colour.
    context.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    context.lineWidth = 1;
    context.beginPath();
    for (let i = 1; i < shown; i++) {
      const at = Math.round(i * LOUPE_ZOOM) + 0.5;
      context.moveTo(at, 0);
      context.lineTo(at, size);
      context.moveTo(0, at);
      context.lineTo(size, at);
    }
    context.stroke();
    // Beside the pointer, kept inside the stage.
    const box = host.element.getBoundingClientRect();
    const left = Math.min(pointer.x - box.left + 16, box.width - LOUPE_SIZE - 4);
    const top = Math.max(4, pointer.y - box.top - LOUPE_SIZE - 16);
    loupe.style.transform = `translate(${Math.max(4, left)}px, ${top}px)`;
  };
  const onPointerMove = (event: PointerEvent) => {
    pointer = { x: event.clientX, y: event.clientY };
    loupe.hidden = !choice.loupe;
    drawLoupe();
  };
  const onPointerLeave = () => {
    pointer = undefined;
    loupe.hidden = true;
  };
  host.element.addEventListener('pointermove', onPointerMove);
  host.element.addEventListener('pointerleave', onPointerLeave);
  // A moving picture changes under a still pointer, so the loupe redraws after every frame.
  const stopFrames = host.onFrame(drawLoupe);

  // --- Sync from the URL --------------------------------------------------------------------
  function apply(query: URLSearchParams) {
    choice = readInspect(query, spec);
    if (viewSelect) viewSelect.value = choice.view;
    for (const [stage, node] of stageButtons) {
      // Pressed means the stage is on, so the default (everything pressed) reads as "all on".
      node.setAttribute('aria-pressed', String(!choice.off.includes(stage)));
    }
    host.setInspect({ view: choice.view, off: choice.off });
    splitButton.setAttribute('aria-pressed', String(choice.split !== undefined));
    split.hidden = choice.split === undefined;
    if (choice.split !== undefined && !dragging) showSplit(choice.split);
    if (choice.split === undefined) host.setSplit(undefined);
    loupeButton.setAttribute('aria-pressed', String(choice.loupe));
    root.dataset.loupe = String(choice.loupe);
    loupe.hidden = !choice.loupe || !pointer;
    host.element.classList.toggle('efp-host--loupe', choice.loupe);
  }
  apply(readQuery());
  const stopQuery = onQueryChange(apply);

  return () => {
    stopQuery();
    stopFrames();
    host.element.removeEventListener('pointermove', onPointerMove);
    host.element.removeEventListener('pointerleave', onPointerLeave);
    host.element.classList.remove('efp-host--loupe');
    host.setSplit(undefined);
    host.setInspect({ view: 'final', off: [] });
    split.remove();
    loupe.remove();
    root.remove();
  };
}
