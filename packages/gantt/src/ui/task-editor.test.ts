/**
 * jsdom unit tests for `GanttTaskEditor`. The `@jects/widgets` Window/Form/Button
 * are mocked so the editor's compose + commit logic (date parsing, duration/
 * percent coercion, milestone flag, save/cancel) is verified without the real
 * widgets build, which evolves concurrently.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const formValues: Record<string, unknown> = {};

vi.mock('@jects/widgets', () => {
  class FakeWindow {
    el: HTMLElement;
    private handlers: Record<string, Array<() => void>> = {};
    constructor(host: HTMLElement) {
      this.el = document.createElement('div');
      const body = document.createElement('div');
      body.className = 'jects-window__body';
      this.el.append(body);
      host.append(this.el);
    }
    on(evt: string, fn: () => void): () => void {
      (this.handlers[evt] ??= []).push(fn);
      return () => {};
    }
    destroy(): void {
      this.el.remove();
    }
  }
  class FakeForm {
    el: HTMLElement;
    constructor(host: HTMLElement) {
      this.el = document.createElement('form');
      host.append(this.el);
    }
    getValue(): Record<string, unknown> {
      return formValues;
    }
    destroy(): void {
      this.el.remove();
    }
  }
  class FakeButton {
    el: HTMLButtonElement;
    private handlers: Record<string, Array<() => void>> = {};
    constructor(host: HTMLElement, cfg: { text?: string }) {
      this.el = document.createElement('button');
      this.el.textContent = cfg.text ?? '';
      host.append(this.el);
    }
    on(evt: string, fn: () => void): () => void {
      (this.handlers[evt] ??= []).push(fn);
      this.el.addEventListener(evt, () => fn());
      return () => {};
    }
    destroy(): void {
      this.el.remove();
    }
  }
  return { Window: FakeWindow, Form: FakeForm, Button: FakeButton };
});

import { GanttTaskEditor } from './task-editor.js';
import type { TaskModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  for (const k of Object.keys(formValues)) delete formValues[k];
});

afterEach(() => {
  host.remove();
});

describe('GanttTaskEditor', () => {
  it('opens a modal window with a form for the task', async () => {
    const editor = new GanttTaskEditor({ host, onSave: () => {} });
    const task: TaskModel = { id: 'a', name: 'Design', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY };
    await editor.open(task);
    expect(editor.isOpen).toBe(true);
    expect(host.querySelector('form')).not.toBeNull();
    editor.destroy();
  });

  it('coerces form values into a typed patch on save', async () => {
    let saved: { id: unknown; patch: Record<string, unknown> } | null = null;
    const editor = new GanttTaskEditor({
      host,
      onSave: (id, patch) => {
        saved = { id, patch };
      },
    });
    const task: TaskModel = { id: 'a', name: 'Design', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY };
    await editor.open(task);

    formValues.name = 'Design v2';
    formValues.start = '2026-01-06';
    formValues.end = '2026-01-09';
    formValues.duration = 3; // days
    formValues.percentDone = 40; // percent
    formValues.milestone = false;

    const saveBtn = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Save')!;
    saveBtn.dispatchEvent(new MouseEvent('click'));

    expect(saved).not.toBeNull();
    expect(saved!.id).toBe('a');
    expect(saved!.patch.name).toBe('Design v2');
    expect(saved!.patch.start).toBe(Date.parse('2026-01-06'));
    expect(saved!.patch.duration).toBe(3 * DAY);
    expect(saved!.patch.percentDone).toBeCloseTo(0.4);
    expect(saved!.patch.milestone).toBe(false);
    expect(editor.isOpen).toBe(false); // closes after save
  });

  it('closes without saving on cancel', async () => {
    const onSave = vi.fn();
    const editor = new GanttTaskEditor({ host, onSave });
    await editor.open({ id: 'a', name: 'A' });
    const cancelBtn = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!;
    cancelBtn.dispatchEvent(new MouseEvent('click'));
    expect(onSave).not.toHaveBeenCalled();
    expect(editor.isOpen).toBe(false);
  });

  it('surfaces effort + effortDriven only when effortEnabled and coerces them', async () => {
    const HOUR = 3_600_000;
    let saved: { id: unknown; patch: Record<string, unknown> } | null = null;
    const editor = new GanttTaskEditor({
      host,
      effortEnabled: true,
      hoursPerDay: 8,
      onSave: (id, patch) => {
        saved = { id, patch };
      },
    });
    await editor.open({ id: 'a', name: 'A', effort: 16 * HOUR } as TaskModel & { effortDriven?: boolean });

    // The effort (person-days) + effort-driven fields are committed.
    formValues.name = 'A';
    formValues.effort = 5; // person-days
    formValues.effortDriven = true;

    const saveBtn = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Save')!;
    saveBtn.dispatchEvent(new MouseEvent('click'));

    expect(saved!.patch.effort).toBe(5 * 8 * HOUR); // 5 person-days at 8h/day
    expect(saved!.patch.effortDriven).toBe(true);
  });

  it('omits effort fields from the patch when effortEnabled is false', async () => {
    let saved: { patch: Record<string, unknown> } | null = null;
    const editor = new GanttTaskEditor({
      host,
      onSave: (_id, patch) => {
        saved = { patch };
      },
    });
    await editor.open({ id: 'a', name: 'A' });
    formValues.effort = 9;
    formValues.effortDriven = true;
    const saveBtn = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Save')!;
    saveBtn.dispatchEvent(new MouseEvent('click'));
    expect('effort' in saved!.patch).toBe(false);
    expect('effortDriven' in saved!.patch).toBe(false);
  });
});
