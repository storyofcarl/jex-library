import { describe, it, expect } from 'vitest';
import { toLink, toLinks, terminalsFor } from './dependencies.js';
import type { DependencyModel } from '../contract.js';

describe('dependency adapter', () => {
  it('maps each precedence type to terminals', () => {
    expect(terminalsFor('FS')).toEqual({ from: 'end', to: 'start' });
    expect(terminalsFor('SS')).toEqual({ from: 'start', to: 'start' });
    expect(terminalsFor('FF')).toEqual({ from: 'end', to: 'end' });
    expect(terminalsFor('SF')).toEqual({ from: 'start', to: 'end' });
  });

  it('defaults to FS', () => {
    expect(terminalsFor(undefined)).toEqual({ from: 'end', to: 'start' });
  });

  it('converts a model to a timeline link preserving ids and styleKey', () => {
    const dep: DependencyModel = { id: 'd1', fromId: 'a', toId: 'b', type: 'SS', styleKey: 'crit' };
    const link = toLink(dep);
    expect(link).toMatchObject({
      id: 'd1',
      fromId: 'a',
      toId: 'b',
      fromSide: 'start',
      toSide: 'start',
      styleKey: 'crit',
    });
  });

  it('omits styleKey when absent', () => {
    const link = toLink({ id: 'd', fromId: 'a', toId: 'b' });
    expect('styleKey' in link).toBe(false);
  });

  it('converts a whole set', () => {
    const links = toLinks([
      { id: 'd1', fromId: 'a', toId: 'b' },
      { id: 'd2', fromId: 'b', toId: 'c', type: 'FF' },
    ]);
    expect(links).toHaveLength(2);
    expect(links[1]!.fromSide).toBe('end');
    expect(links[1]!.toSide).toBe('end');
  });
});
