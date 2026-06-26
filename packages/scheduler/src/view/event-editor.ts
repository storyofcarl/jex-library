/**
 * Event editor popup — reuses the `@jects/widgets` `Window` as the chrome and
 * builds a small token-pure form inside it (name + start/end datetime). On save
 * it invokes the supplied callback with the changed fields; the scheduler owns
 * writing those back through its event store (with veto + events).
 *
 * Kept tiny and dependency-light: the form is plain inputs wired by hand rather
 * than the full Form/field stack, so the editor stays robust in jsdom and the
 * real browser alike while still demonstrating the Window reuse.
 */

import { createEl } from '@jects/core';
import { Window } from '@jects/widgets';
import type { EventModel } from '../contract.js';

/** Fields the editor can change. */
export interface EventEditChanges {
  name?: string;
  startDate?: number;
  endDate?: number;
}

/** Format an epoch-ms time as a `datetime-local` input value (UTC). */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  );
}

/** Parse a `datetime-local` value back to epoch ms (interpreted as UTC). */
function fromLocalInput(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const [, y, mo, d, hh, mm] = m;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm));
}

/**
 * Open the editor for `record`. Calls `onSave` with the changed fields when the
 * user confirms, then closes. Returns the `Window` instance (already mounted).
 */
export function openEventEditor(
  host: HTMLElement,
  record: EventModel,
  onSave: (changes: EventEditChanges) => void,
): Window {
  const body = createEl('div', { className: 'jects-scheduler-editor' });

  const nameField = field(body, 'Name', 'text', record.name ?? '');
  const startField = field(body, 'Start', 'datetime-local', toLocalInput(record.startDate));
  const endField = field(body, 'End', 'datetime-local', toLocalInput(record.endDate));

  const actions = createEl('div', { className: 'jects-scheduler-editor__actions' });
  const cancelBtn = createEl('button', { className: 'jects-scheduler-editor__btn' });
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  const saveBtn = createEl('button', {
    className: 'jects-scheduler-editor__btn jects-scheduler-editor__btn--primary',
  });
  saveBtn.type = 'button';
  saveBtn.textContent = 'Save';
  actions.append(cancelBtn, saveBtn);
  body.appendChild(actions);

  const win = new Window(host, {
    title: 'Edit event',
    width: 360,
    height: 280,
    modal: false,
    label: 'Edit event',
  });
  // Place the form into the window body.
  const panel = win.el.querySelector('.jects-window__body') ?? win.el;
  panel.appendChild(body);

  cancelBtn.addEventListener('click', () => win.destroy());
  saveBtn.addEventListener('click', () => {
    const changes: EventEditChanges = {};
    changes.name = nameField.value;
    const start = fromLocalInput(startField.value);
    const end = fromLocalInput(endField.value);
    if (start != null) changes.startDate = start;
    if (end != null && (start == null || end > start)) changes.endDate = end;
    onSave(changes);
    win.destroy();
  });

  // Focus the first field for keyboard users.
  nameField.focus();
  return win;
}

/** Build a labelled input row, returning the input element. */
function field(
  parent: HTMLElement,
  label: string,
  type: string,
  value: string,
): HTMLInputElement {
  const row = createEl('label', { className: 'jects-scheduler-editor__row' });
  const span = createEl('span', { className: 'jects-scheduler-editor__label' });
  span.textContent = label;
  const input = createEl('input', { className: 'jects-scheduler-editor__input' });
  input.type = type;
  input.value = value;
  row.append(span, input);
  parent.appendChild(row);
  return input;
}
