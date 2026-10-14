import { describe, expect, it } from 'vitest';
import { DEFAULT_SPLIT, readInspect, writeInspect } from '../src/shell/inspect-url.ts';

const spec = { views: ['albedo', 'depth'], stages: ['bloom', 'glow'] };
const read = (search: string, s = spec) => readInspect(new URLSearchParams(search), s);

describe('inspector URL state', () => {
  it('defaults to the final picture with everything on', () => {
    expect(read('')).toEqual({ view: 'final', off: [], split: undefined, loupe: false });
  });

  it('keeps only what the effect declares', () => {
    expect(read('view=normals&off=bloom,fog,bloom').view).toBe('final');
    expect(read('view=depth&off=bloom,fog,bloom')).toMatchObject({ view: 'depth', off: ['bloom'] });
  });

  it('reads the split as a percentage, clamped, and only when there are stages to switch off', () => {
    expect(read('split=40').split).toBeCloseTo(0.4);
    expect(read('split=250').split).toBe(1);
    expect(read('split=oops').split).toBe(DEFAULT_SPLIT);
    expect(read('split=40', { views: [], stages: [] }).split).toBeUndefined();
  });

  it('writes the smallest URL that reads back the same', () => {
    expect(writeInspect({ view: 'final', off: [], split: undefined, loupe: false })).toEqual({
      view: null,
      off: null,
      split: null,
      loupe: null,
    });
    const changes = writeInspect({ view: 'depth', off: ['glow'], split: 0.25, loupe: true });
    expect(changes).toEqual({ view: 'depth', off: 'glow', split: '25', loupe: '1' });
    const query = new URLSearchParams(
      Object.entries(changes).flatMap(([key, value]) => (value ? [[key, value]] : [])),
    );
    expect(read(query.toString())).toEqual({
      view: 'depth',
      off: ['glow'],
      split: 0.25,
      loupe: true,
    });
  });
});
