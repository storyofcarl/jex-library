/** jsdom unit test for the undo/redo stack. */
import { describe, it, expect } from 'vitest';
import { History, type Command } from './history.js';

function counterCmd(log: string[], label: string): Command {
  return {
    label,
    redo: () => log.push(`do:${label}`),
    undo: () => log.push(`undo:${label}`),
  };
}

describe('History', () => {
  it('pushes and runs a command, enabling undo', () => {
    const log: string[] = [];
    const h = new History();
    expect(h.canUndo).toBe(false);
    h.push(counterCmd(log, 'a'));
    expect(log).toEqual(['do:a']);
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);
  });

  it('undoes and redoes in order', () => {
    const log: string[] = [];
    const h = new History();
    h.push(counterCmd(log, 'a'));
    h.push(counterCmd(log, 'b'));
    h.undo();
    expect(log).toEqual(['do:a', 'do:b', 'undo:b']);
    expect(h.canRedo).toBe(true);
    h.redo();
    expect(log).toEqual(['do:a', 'do:b', 'undo:b', 'do:b']);
  });

  it('record() registers without running', () => {
    const log: string[] = [];
    const h = new History();
    h.record(counterCmd(log, 'x'));
    expect(log).toEqual([]); // not run
    h.undo();
    expect(log).toEqual(['undo:x']);
  });

  it('clears the redo stack on a new push', () => {
    const h = new History();
    h.push(counterCmd([], 'a'));
    h.undo();
    expect(h.canRedo).toBe(true);
    h.push(counterCmd([], 'b'));
    expect(h.canRedo).toBe(false);
  });

  it('suppresses re-entrant pushes while applying', () => {
    const log: string[] = [];
    const h = new History();
    const cmd: Command = {
      label: 'outer',
      redo: () => {
        log.push('do:outer');
        h.push(counterCmd(log, 'inner')); // ignored while applying
      },
      undo: () => log.push('undo:outer'),
    };
    h.push(cmd);
    expect(log).toEqual(['do:outer']);
    expect(h.canUndo).toBe(true);
  });
});
