// URL state for the layer inspector (stories 2.2 to 2.4), so a view, the stages switched off, the
// before/after split and the loupe survive a reload and can be shared as a link:
//
//   ?effect=hello&view=depth            one view
//   ?effect=hello&off=bloom,glow        stages switched off
//   ?effect=hello&split=40              before/after, split at 40% of the width
//   ?effect=hello&loupe=1               the texel loupe
//
// Anything the effect does not declare is dropped, so a stale link falls back to the final picture.
import type { InspectSpec } from '../effects/types.ts';
import type { QueryChanges } from './router.ts';

export interface InspectChoice {
  view: string;
  off: string[];
  /** 0..1, or undefined when the split is off. */
  split: number | undefined;
  loupe: boolean;
}

export const DEFAULT_SPLIT = 0.5;

export function readInspect(query: URLSearchParams, spec: InspectSpec = {}): InspectChoice {
  const views = spec.views ?? [];
  const stages = spec.stages ?? [];
  const view = query.get('view') ?? 'final';
  const off = (query.get('off') ?? '').split(',').filter((stage) => stages.includes(stage));
  const rawSplit = query.get('split');
  const percent = rawSplit === null ? NaN : Number(rawSplit);
  return {
    view: views.includes(view) ? view : 'final',
    off: [...new Set(off)],
    split:
      stages.length > 0 && rawSplit !== null
        ? Number.isFinite(percent)
          ? Math.min(1, Math.max(0, percent / 100))
          : DEFAULT_SPLIT
        : undefined,
    loupe: query.get('loupe') === '1',
  };
}

export function writeInspect(choice: Partial<InspectChoice>): QueryChanges {
  const changes: Record<string, string | null> = {};
  if (choice.view !== undefined) changes.view = choice.view === 'final' ? null : choice.view;
  if (choice.off !== undefined) changes.off = choice.off.length ? choice.off.join(',') : null;
  if ('split' in choice) {
    changes.split = choice.split === undefined ? null : String(Math.round(choice.split * 100));
  }
  if (choice.loupe !== undefined) changes.loupe = choice.loupe ? '1' : null;
  return changes;
}
