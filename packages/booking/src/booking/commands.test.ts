import { describe, it, expect, vi } from 'vitest';
import { CommandStack, SelectionModel, command } from './commands.js';

describe('CommandStack', () => {
  it('executes, undoes and redoes commands', () => {
    let value = 0;
    const stack = new CommandStack();
    stack.execute(command('inc', () => (value += 1), () => (value -= 1)));
    expect(value).toBe(1);
    expect(stack.canUndo()).toBe(true);
    expect(stack.canRedo()).toBe(false);

    stack.undo();
    expect(value).toBe(0);
    expect(stack.canRedo()).toBe(true);

    stack.redo();
    expect(value).toBe(1);
  });

  it('push() registers an already-applied command without re-running do()', () => {
    let value = 5;
    const stack = new CommandStack();
    stack.push(command('set', () => (value = 5), () => (value = 0)));
    expect(value).toBe(5); // do() not re-run
    stack.undo();
    expect(value).toBe(0);
  });

  it('a new execute clears the redo stack', () => {
    let v = 0;
    const stack = new CommandStack();
    stack.execute(command('a', () => (v += 1), () => (v -= 1)));
    stack.undo();
    stack.execute(command('b', () => (v += 10), () => (v -= 10)));
    expect(stack.canRedo()).toBe(false);
    expect(v).toBe(10);
  });

  it('emits change with can-undo/redo flags', () => {
    const stack = new CommandStack();
    const spy = vi.fn();
    stack.on('change', spy);
    stack.execute(command('x', () => {}, () => {}));
    expect(spy).toHaveBeenCalledWith({ canUndo: true, canRedo: false });
  });
});

describe('SelectionModel', () => {
  it('toggles, selects, deselects and clears with change events', () => {
    const sel = new SelectionModel<string>();
    const spy = vi.fn();
    sel.on('change', spy);

    sel.toggle('a');
    expect(sel.has('a')).toBe(true);
    expect(sel.size).toBe(1);
    sel.toggle('a');
    expect(sel.has('a')).toBe(false);

    sel.set_(['a', 'b', 'c']);
    expect(sel.all().sort()).toEqual(['a', 'b', 'c']);
    sel.deselect('b');
    expect(sel.all().sort()).toEqual(['a', 'c']);
    sel.clearSelection();
    expect(sel.size).toBe(0);
    expect(spy).toHaveBeenCalled();
  });
});
