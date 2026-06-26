/**
 * @jects/calendar — event editor.
 *
 * A self-contained modal editor for creating/editing events. It REUSES the
 * @jects/widgets `Window` (draggable, modal, focus-trapped, Escape-to-close)
 * as the shell and builds a token-styled form inside its body. We deliberately
 * keep the form native (inputs/selects) so the calendar does not hard-couple to
 * every widgets field's internal API; the Window provides the a11y shell.
 */

import { createEl } from '@jects/core';
import { Window } from '@jects/widgets';
import type {
  CalendarCategory,
  CalendarEvent,
  CalendarResource,
  RecurrenceFreq,
  RecurrenceRule,
} from './contract.js';
import { toLocalInput, toDateInput, parseLocal, type Weekday } from './date-utils.js';

export interface EditorResult {
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  description: string;
  location: string;
  categoryId?: string | undefined;
  resourceId?: string | undefined;
  /**
   * The fully-built recurrence rule from the editor's advanced inputs (interval /
   * byWeekday / count / until / exDates), or undefined when "Does not repeat".
   */
  recurrence?: RecurrenceRule | undefined;
}

export interface EditorOptions {
  /** Existing event for edit mode; null/undefined for create. */
  event?: Partial<CalendarEvent> | null | undefined;
  /** Default range when creating. */
  defaultStart: Date;
  defaultEnd: Date;
  defaultAllDay?: boolean | undefined;
  defaultResourceId?: string | undefined;
  categories: CalendarCategory[];
  resources: CalendarResource[];
  onSave(result: EditorResult): void;
  onDelete?: (() => void) | undefined;
  onCancel?: (() => void) | undefined;
}

const FREQS: Array<{ value: '' | RecurrenceFreq; label: string }> = [
  { value: '', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

/**
 * Open the event editor as a modal Window. Returns the Window instance.
 *
 * The modal is hosted on `document.body` (not the calendar element passed as
 * `host`) so it overlays at the top of the stacking context and is never clipped
 * by the calendar's own scroll/overflow containers. The `host` argument is kept
 * for API symmetry and is no longer used as the mount point.
 */
export function openEventEditor(_host: HTMLElement, opts: EditorOptions): Window {
  const ev = opts.event ?? null;
  const isEdit = !!(ev && ev.id !== undefined);
  const allDay = ev?.allDay ?? opts.defaultAllDay ?? false;
  const start = (ev?.start as Date | undefined) ?? opts.defaultStart;
  const end = (ev?.end as Date | undefined) ?? opts.defaultEnd;

  const win = new Window(document.body, {
    title: isEdit ? 'Edit event' : 'New event',
    modal: true,
    width: 420,
    height: 520,
    closable: true,
    maximizable: false,
    resizable: true,
    cls: 'jects-cal-editor-window',
  });

  const body = win.el.querySelector<HTMLElement>('.jects-window__body') ?? win.el;
  body.classList.add('jects-cal-editor');

  const form = createEl('form', { className: 'jects-cal-editor__form' });
  form.setAttribute('novalidate', '');

  const field = (labelText: string, control: HTMLElement, id: string): HTMLElement => {
    const wrap = createEl('div', { className: 'jects-cal-editor__field' });
    const label = createEl('label', { className: 'jects-cal-editor__label' });
    label.textContent = labelText;
    label.htmlFor = id;
    control.id = id;
    wrap.append(label, control);
    return wrap;
  };

  // Title
  const titleInput = createEl('input', { className: 'jects-cal-editor__input' });
  titleInput.type = 'text';
  titleInput.value = ev?.title ?? '';
  titleInput.required = true;
  titleInput.placeholder = 'Add title';

  // All-day toggle
  const allDayInput = createEl('input', { className: 'jects-cal-editor__check' });
  allDayInput.type = 'checkbox';
  allDayInput.checked = allDay;
  const allDayWrap = createEl('div', { className: 'jects-cal-editor__field jects-cal-editor__field--inline' });
  const allDayLabel = createEl('label', { className: 'jects-cal-editor__label' });
  allDayLabel.textContent = 'All day';
  allDayLabel.htmlFor = 'jects-cal-allday';
  allDayInput.id = 'jects-cal-allday';
  allDayWrap.append(allDayInput, allDayLabel);

  // Start / end
  const startInput = createEl('input', { className: 'jects-cal-editor__input' });
  const endInput = createEl('input', { className: 'jects-cal-editor__input' });

  const syncDateType = (): void => {
    const type = allDayInput.checked ? 'date' : 'datetime-local';
    startInput.type = type;
    endInput.type = type;
    startInput.value = allDayInput.checked ? toDateInput(start) : toLocalInput(start);
    endInput.value = allDayInput.checked ? toDateInput(end) : toLocalInput(end);
  };
  syncDateType();
  allDayInput.addEventListener('change', () => {
    // Preserve current parsed values across type switch.
    const s = parseLocal(startInput.value) ?? start;
    const e = parseLocal(endInput.value) ?? end;
    startInput.type = allDayInput.checked ? 'date' : 'datetime-local';
    endInput.type = allDayInput.checked ? 'date' : 'datetime-local';
    startInput.value = allDayInput.checked ? toDateInput(s) : toLocalInput(s);
    endInput.value = allDayInput.checked ? toDateInput(e) : toLocalInput(e);
  });

  // Category
  const catSelect = createEl('select', { className: 'jects-cal-editor__select' });
  catSelect.append(new Option('— None —', ''));
  for (const c of opts.categories) {
    const o = new Option(c.name, c.id);
    if (ev?.categoryId === c.id) o.selected = true;
    catSelect.append(o);
  }

  // Resource
  const resSelect = createEl('select', { className: 'jects-cal-editor__select' });
  resSelect.append(new Option('— None —', ''));
  for (const r of opts.resources) {
    const o = new Option(r.name, r.id);
    if ((ev?.resourceId ?? opts.defaultResourceId) === r.id) o.selected = true;
    resSelect.append(o);
  }

  // Recurrence — frequency select + advanced detail rows.
  const rule0 = ev?.recurrence;
  const recSelect = createEl('select', { className: 'jects-cal-editor__select' });
  for (const f of FREQS) {
    const o = new Option(f.label, f.value);
    if ((rule0?.freq ?? '') === f.value) o.selected = true;
    recSelect.append(o);
  }

  // Advanced detail: interval, weekly weekdays, end (never/count/until), exDates.
  const recDetail = createEl('div', { className: 'jects-cal-editor__rec-detail' });

  const intervalInput = createEl('input', { className: 'jects-cal-editor__input jects-cal-editor__rec-num' });
  intervalInput.type = 'number';
  intervalInput.min = '1';
  intervalInput.value = String(Math.max(1, rule0?.interval ?? 1));
  intervalInput.setAttribute('aria-label', 'Repeat interval');
  const intervalRow = createEl('div', { className: 'jects-cal-editor__rec-row' });
  const intervalLead = createEl('span', { className: 'jects-cal-editor__rec-lbl' });
  intervalLead.textContent = 'Repeat every';
  const intervalUnit = createEl('span', { className: 'jects-cal-editor__rec-unit' });
  intervalRow.append(intervalLead, intervalInput, intervalUnit);
  recDetail.append(intervalRow);

  // Weekly weekday checkboxes (0=Sun..6=Sat).
  const weekdaysRow = createEl('div', { className: 'jects-cal-editor__rec-row jects-cal-editor__weekdays' });
  const weekdayBoxes: HTMLInputElement[] = [];
  const WD_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const seededDays = new Set<number>(rule0?.byWeekday ?? []);
  for (let i = 0; i < 7; i++) {
    const lab = createEl('label', { className: 'jects-cal-editor__weekday' });
    const cb = createEl('input', { className: 'jects-cal-editor__weekday-cb' });
    cb.type = 'checkbox';
    cb.value = String(i);
    cb.checked = seededDays.has(i);
    cb.setAttribute('aria-label', ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i]!);
    const txt = createEl('span', { className: 'jects-cal-editor__weekday-txt' });
    txt.textContent = WD_LABELS[i]!;
    lab.append(cb, txt);
    weekdaysRow.append(lab);
    weekdayBoxes.push(cb);
  }
  recDetail.append(weekdaysRow);

  // End condition.
  const endRow = createEl('div', { className: 'jects-cal-editor__rec-row' });
  const endSelect = createEl('select', { className: 'jects-cal-editor__select jects-cal-editor__rec-end' });
  endSelect.setAttribute('aria-label', 'Recurrence end');
  for (const [v, label] of [['never', 'Never'], ['count', 'After N times'], ['until', 'On date']] as const) {
    endSelect.append(new Option(label, v));
  }
  const countInput = createEl('input', { className: 'jects-cal-editor__input jects-cal-editor__rec-num' });
  countInput.type = 'number';
  countInput.min = '1';
  countInput.value = String(rule0?.count ?? 10);
  countInput.setAttribute('aria-label', 'Number of occurrences');
  const untilInput = createEl('input', { className: 'jects-cal-editor__input' });
  untilInput.type = 'date';
  untilInput.value = toDateInput(rule0?.until ?? new Date(end.getTime() + 30 * 86_400_000));
  untilInput.setAttribute('aria-label', 'Repeat until date');
  endSelect.value = rule0?.count != null ? 'count' : rule0?.until ? 'until' : 'never';
  const endLbl = createEl('span', { className: 'jects-cal-editor__rec-lbl' });
  endLbl.textContent = 'Ends';
  endRow.append(endLbl, endSelect, countInput, untilInput);
  recDetail.append(endRow);

  // Exception dates (comma-separated YYYY-MM-DD).
  const exRow = createEl('div', { className: 'jects-cal-editor__rec-row' });
  const exInput = createEl('input', { className: 'jects-cal-editor__input jects-cal-editor__rec-ex' });
  exInput.type = 'text';
  exInput.placeholder = 'e.g. 2026-07-01, 2026-07-08';
  exInput.setAttribute('aria-label', 'Exception dates (comma-separated)');
  exInput.value = (rule0?.exDates ?? []).map((d) => toDateInput(d)).join(', ');
  const exLbl = createEl('span', { className: 'jects-cal-editor__rec-lbl' });
  exLbl.textContent = 'Skip dates';
  exRow.append(exLbl, exInput);
  recDetail.append(exRow);

  const unitFor = (f: string): string => {
    const n = Number(intervalInput.value) || 1;
    const plural = n === 1 ? '' : 's';
    return ({ daily: `day${plural}`, weekly: `week${plural}`, monthly: `month${plural}`, yearly: `year${plural}` } as Record<string, string>)[f] ?? '';
  };
  const syncRecVisibility = (): void => {
    const f = recSelect.value;
    recDetail.style.display = f ? '' : 'none';
    weekdaysRow.style.display = f === 'weekly' ? '' : 'none';
    intervalUnit.textContent = unitFor(f);
    countInput.style.display = endSelect.value === 'count' ? '' : 'none';
    untilInput.style.display = endSelect.value === 'until' ? '' : 'none';
  };
  recSelect.addEventListener('change', syncRecVisibility);
  endSelect.addEventListener('change', syncRecVisibility);
  intervalInput.addEventListener('input', () => (intervalUnit.textContent = unitFor(recSelect.value)));

  /** Build the recurrence rule from the advanced inputs (or undefined). */
  const buildRecurrence = (): RecurrenceRule | undefined => {
    const freq = recSelect.value as RecurrenceFreq | '';
    if (!freq) return undefined;
    const rule: RecurrenceRule = { freq };
    const interval = Math.max(1, Math.floor(Number(intervalInput.value) || 1));
    if (interval > 1) rule.interval = interval;
    if (freq === 'weekly') {
      const days = weekdayBoxes.filter((b) => b.checked).map((b) => Number(b.value) as Weekday);
      if (days.length > 0) rule.byWeekday = days.sort((a, b) => a - b);
    }
    if (endSelect.value === 'count') {
      const c = Math.max(1, Math.floor(Number(countInput.value) || 1));
      rule.count = c;
    } else if (endSelect.value === 'until') {
      const u = parseLocal(untilInput.value);
      if (u) rule.until = u;
    }
    const exDates = exInput.value
      .split(',')
      .map((s) => parseLocal(s.trim()))
      .filter((d): d is Date => d !== null);
    if (exDates.length > 0) rule.exDates = exDates;
    return rule;
  };

  // Location + description
  const locInput = createEl('input', { className: 'jects-cal-editor__input' });
  locInput.type = 'text';
  locInput.value = ev?.location ?? '';
  const descInput = createEl('textarea', { className: 'jects-cal-editor__textarea' });
  descInput.value = ev?.description ?? '';
  descInput.rows = 3;

  form.append(
    field('Title', titleInput, 'jects-cal-title'),
    allDayWrap,
    field('Start', startInput, 'jects-cal-start'),
    field('End', endInput, 'jects-cal-end'),
    field('Category', catSelect, 'jects-cal-cat'),
  );
  if (opts.resources.length > 0) {
    form.append(field('Resource', resSelect, 'jects-cal-res'));
  }
  form.append(
    field('Repeat', recSelect, 'jects-cal-rec'),
    recDetail,
    field('Location', locInput, 'jects-cal-loc'),
    field('Description', descInput, 'jects-cal-desc'),
  );
  syncRecVisibility();

  // Footer buttons
  const footer = createEl('div', { className: 'jects-cal-editor__footer' });
  if (isEdit && opts.onDelete) {
    const del = createEl('button', { className: 'jects-cal-editor__btn jects-cal-editor__btn--danger' });
    del.type = 'button';
    del.textContent = 'Delete';
    del.addEventListener('click', () => {
      opts.onDelete?.();
      win.destroy();
    });
    footer.append(del);
  }
  const spacer = createEl('div', { className: 'jects-cal-editor__spacer' });
  const cancel = createEl('button', { className: 'jects-cal-editor__btn' });
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => {
    opts.onCancel?.();
    win.destroy();
  });
  const save = createEl('button', { className: 'jects-cal-editor__btn jects-cal-editor__btn--primary' });
  save.type = 'submit';
  save.textContent = isEdit ? 'Save' : 'Create';
  footer.append(spacer, cancel, save);

  form.append(footer);
  body.append(form);

  const submit = (e: Event): void => {
    e.preventDefault();
    const title = titleInput.value.trim() || '(no title)';
    const isAllDay = allDayInput.checked;
    const s = parseLocal(startInput.value) ?? start;
    let en = parseLocal(endInput.value) ?? end;
    if (en.getTime() < s.getTime()) en = new Date(s.getTime() + 3_600_000);
    opts.onSave({
      title,
      start: s,
      end: en,
      allDay: isAllDay,
      description: descInput.value,
      location: locInput.value,
      categoryId: catSelect.value || undefined,
      resourceId: resSelect.value || undefined,
      // The editor now surfaces the full rule (freq + interval/byWeekday/count/
      // until/exDates); commitEditor takes it as-is.
      recurrence: buildRecurrence(),
    });
    win.destroy();
  };
  form.addEventListener('submit', submit);

  // Focus the title for quick entry.
  queueMicrotask(() => titleInput.focus());

  return win;
}
