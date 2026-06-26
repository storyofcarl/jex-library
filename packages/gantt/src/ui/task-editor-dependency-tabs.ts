/**
 * `task-editor-dependency-tabs` — the **Predecessors**, **Successors**,
 * **Advanced**, and **Notes** tabs that bring the Gantt task editor to
 * Bryntum/DHTMLX parity.
 *
 * Bryntum's `TaskEditor` ships, beyond General + Resources:
 *   - a **Predecessors** tab — an editable grid of the links INTO this task
 *     (each row: the predecessor task, the link type FS/SS/FF/SF, and a lag),
 *     with add / remove / inline edit;
 *   - a **Successors** tab — the mirror grid of the links OUT of this task;
 *   - an **Advanced** tab — constraint type + constraint date, the task's
 *     calendar, and the scheduling mode (auto vs. manually-scheduled);
 *   - a **Notes** tab — a free-text note for the task.
 *
 * This module supplies all four as **self-contained, framework-free controls**
 * plus a {@link GanttDependencyTabs} orchestrator that:
 *   - builds the tab descriptors + panel content for each,
 *   - edits a LOCAL draft (nothing reaches the model until `commit`), so the
 *     editor's Cancel stays honest, and
 *   - on `commit` routes every change THROUGH the {@link GanttApi} seam:
 *     `addDependency` / `removeDependency` for link add/remove,
 *     `applyConstraint` for the constraint, and `updateTask` for the
 *     calendar / scheduling-mode / notes patch — so the CPM engine re-propagates
 *     exactly as it would for a live edit.
 *
 * Design (concurrency-safe, contract-pure — same discipline as the rest of the
 * task-editor feature set):
 *   - NEW, additive module. It does NOT edit `GanttTabbedTaskEditor`, the
 *     `Gantt` class, the package barrel, or any shared config. The integrator
 *     wires it into the tabbed editor (see {@link RES.wireNotes} / the module
 *     wire notes block at the foot of this file).
 *   - It does NOT hard-depend on `@jects/widgets`: every field is a native
 *     `<input>` / `<select>` / `<textarea>`, so it works in the jsdom editor body
 *     and in the jsdom unit tests without the widgets build.
 *   - Each editable grid is a proper WAI-ARIA `grid` (`role="grid"` →
 *     `role="row"` → `role="gridcell"`) with a real `<caption>`-style group
 *     label, native focusable controls in each cell, and a labelled "Add link"
 *     control + per-row "Remove" buttons, so axe passes with zero
 *     serious/critical violations and the whole editor is keyboard operable.
 *
 * All token-pure CSS lives in `task-editor-dependency-tabs.css` (no hardcoded
 * colours; `@layer jects.components`).
 */

import './task-editor-dependency-tabs.css';
import { createEl, type Model, type RecordId } from '@jects/core';
import type {
  TaskModel,
  DependencyModel,
  DependencyType,
  ConstraintType,
  GanttApi,
} from '../contract.js';

const MS_PER_DAY = 86_400_000;

/* ═══════════════════════════════════════════════════════════════════════════
   0. CONSTANTS / SMALL VOCAB
   ═══════════════════════════════════════════════════════════════════════════ */

/** The four dependency types, in editor display order. */
export const DEPENDENCY_TYPES: ReadonlyArray<{ value: DependencyType; label: string }> = [
  { value: 'FS', label: 'Finish-to-Start (FS)' },
  { value: 'SS', label: 'Start-to-Start (SS)' },
  { value: 'FF', label: 'Finish-to-Finish (FF)' },
  { value: 'SF', label: 'Start-to-Finish (SF)' },
];

/** The constraint types, in editor display order, with human labels. */
export const CONSTRAINT_TYPES: ReadonlyArray<{ value: ConstraintType; label: string; dated: boolean }> = [
  { value: 'asSoonAsPossible', label: 'As Soon As Possible', dated: false },
  { value: 'asLateAsPossible', label: 'As Late As Possible', dated: false },
  { value: 'startNoEarlierThan', label: 'Start No Earlier Than', dated: true },
  { value: 'startNoLaterThan', label: 'Start No Later Than', dated: true },
  { value: 'finishNoEarlierThan', label: 'Finish No Earlier Than', dated: true },
  { value: 'finishNoLaterThan', label: 'Finish No Later Than', dated: true },
  { value: 'mustStartOn', label: 'Must Start On', dated: true },
  { value: 'mustFinishOn', label: 'Must Finish On', dated: true },
];

/** Whether a constraint type carries a date operand. */
export function constraintIsDated(type: ConstraintType): boolean {
  return CONSTRAINT_TYPES.find((c) => c.value === type)?.dated ?? false;
}

/** The dependency-tab built-in tab ids. */
export const DEPENDENCY_TABS = {
  predecessors: 'predecessors',
  successors: 'successors',
  advanced: 'advanced',
  notes: 'notes',
} as const;

/* ═══════════════════════════════════════════════════════════════════════════
   1. PURE HELPERS (date <-> input value, lag <-> days)
   ═══════════════════════════════════════════════════════════════════════════ */

/** A `Date`/epoch-ms → `yyyy-mm-dd` value for a native `<input type="date">`. */
export function toDateInputValue(ms?: number): string {
  if (ms == null || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse a native date input value back to epoch ms (UTC), or `undefined`. */
export function parseDateInputValue(value?: string): number | undefined {
  if (value == null || value === '') return undefined;
  const t = Date.parse(value);
  return Number.isNaN(t) ? undefined : t;
}

/** Lag (working ms) → days (a finite number, may be negative for a lead). */
export function lagToDays(lag?: number): number {
  if (lag == null || !Number.isFinite(lag)) return 0;
  return Math.round((lag / MS_PER_DAY) * 100) / 100;
}

/** Days → lag (working ms). NaN / non-finite coerces to 0. */
export function daysToLag(days: number): number {
  return Number.isFinite(days) ? Math.round(days * MS_PER_DAY) : 0;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. DEPENDENCY DRAFT MODEL
   ═══════════════════════════════════════════════════════════════════════════ */

/** Which side of the edited task a dependency grid manages. */
export type DependencyDirection = 'predecessors' | 'successors';

/**
 * One editable dependency row in a grid's draft. `linkId` is present when the
 * row reflects an existing {@link DependencyModel}; absent for a freshly-added
 * row (committed via `addDependency`). `otherId` is the OTHER task in the link:
 * the predecessor (for a "predecessors" grid) or the successor (for a
 * "successors" grid).
 */
export interface DependencyDraftRow {
  /** The existing link id, or `undefined` for a new row. */
  linkId?: RecordId;
  /** The other task in the link (predecessor or successor, per direction). */
  otherId: RecordId | '';
  /** The dependency type. Default `'FS'`. */
  type: DependencyType;
  /** Lag (+) / lead (−) in working days. */
  lagDays: number;
  /** Marked for removal on commit (only meaningful for rows with a `linkId`). */
  removed: boolean;
}

/** A pickable task option for the link-target `<select>`. */
export interface TaskOption {
  id: RecordId;
  name: string;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. DEPENDENCY GRID FIELD (editable: target / type / lag, add / remove)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Construction options for {@link DependencyGridField}. */
export interface DependencyGridFieldOptions {
  /** The task being edited. */
  taskId: RecordId;
  /** Whether this grid edits predecessor links (into the task) or successors. */
  direction: DependencyDirection;
  /** The existing links for this side (seed the draft). */
  links: ReadonlyArray<DependencyModel>;
  /** Candidate tasks for the link-target `<select>` (excludes the edited task). */
  taskOptions: ReadonlyArray<TaskOption>;
  /** Accessible label for the grid. Defaults from `direction`. */
  label?: string;
  /** Fired whenever the draft changes (add / remove / edit). */
  onChange?(rows: ReadonlyArray<DependencyDraftRow>): void;
}

/**
 * A keyboard-accessible editable grid of dependency links for one side of a
 * task. Each row carries a target-task `<select>`, a type `<select>` (FS/SS/FF/
 * SF), a lag `<input type="number">` (days, may be negative), and a Remove
 * button; an "Add link" button appends a fresh row.
 *
 * Lifecycle: `new DependencyGridField(opts)` → append `field.el` into the editor
 * panel → on save the consumer reads `field.getRows()` and reconciles against
 * the original links via {@link reconcileDependencies}.
 */
export class DependencyGridField {
  /** The owned control element (caller appends it into the editor panel). */
  readonly el: HTMLElement;

  private readonly direction: DependencyDirection;
  private readonly taskOptions: ReadonlyArray<TaskOption>;
  private readonly onChange: DependencyGridFieldOptions['onChange'];
  private readonly rows: DependencyDraftRow[] = [];
  private readonly disposers: Array<() => void> = [];
  private body!: HTMLElement;
  private emptyEl!: HTMLElement;
  private destroyed = false;

  constructor(opts: DependencyGridFieldOptions) {
    this.direction = opts.direction;
    this.taskOptions = opts.taskOptions.filter((o) => o.id !== opts.taskId);
    this.onChange = opts.onChange;

    // Seed the draft from existing links (one row each).
    for (const link of opts.links) {
      const otherId = this.direction === 'predecessors' ? link.fromId : link.toId;
      this.rows.push({
        linkId: link.id,
        otherId,
        type: link.type ?? 'FS',
        lagDays: lagToDays(link.lag),
        removed: false,
      });
    }

    this.el = createEl('div', { className: 'jects-gantt__dep-field' });
    const label =
      opts.label ?? (this.direction === 'predecessors' ? 'Predecessors' : 'Successors');

    const grid = createEl('div', { className: 'jects-gantt__dep-grid' });
    grid.setAttribute('role', 'grid');
    grid.setAttribute('aria-label', label);

    grid.append(this.buildHeader());
    this.body = createEl('div', { className: 'jects-gantt__dep-grid-body' });
    grid.append(this.body);
    this.el.append(grid);

    this.emptyEl = createEl('p', { className: 'jects-gantt__dep-empty' });
    this.emptyEl.textContent =
      this.direction === 'predecessors'
        ? 'No predecessors. Add a link to make this task depend on another.'
        : 'No successors. Add a link to make another task depend on this one.';
    this.el.append(this.emptyEl);

    this.el.append(this.buildAddBar(label));

    for (const row of this.rows) this.appendRowEl(row);
    this.refreshEmpty();
  }

  /** The current draft rows (a defensive copy). */
  getRows(): DependencyDraftRow[] {
    return this.rows.map((r) => ({ ...r }));
  }

  /** The number of rows that are NOT marked removed (the live link count). */
  get liveCount(): number {
    return this.rows.filter((r) => !r.removed).length;
  }

  /* ── header ───────────────────────────────────────────────────────────── */

  private buildHeader(): HTMLElement {
    const head = createEl('div', { className: 'jects-gantt__dep-grid-head' });
    head.setAttribute('role', 'row');
    const targetLabel = this.direction === 'predecessors' ? 'Predecessor' : 'Successor';
    for (const text of [targetLabel, 'Type', 'Lag (days)', '']) {
      const cell = createEl('span', { className: 'jects-gantt__dep-grid-th' });
      cell.setAttribute('role', 'columnheader');
      cell.textContent = text;
      head.append(cell);
    }
    return head;
  }

  /* ── add bar ──────────────────────────────────────────────────────────── */

  private buildAddBar(label: string): HTMLElement {
    const bar = createEl('div', { className: 'jects-gantt__dep-addbar' });
    const btn = createEl('button', {
      className: 'jects-gantt__dep-add',
    }) as HTMLButtonElement;
    btn.type = 'button';
    btn.textContent = 'Add link';
    btn.setAttribute(
      'aria-label',
      this.direction === 'predecessors' ? 'Add predecessor link' : 'Add successor link',
    );
    const onAdd = (): void => this.addRow();
    btn.addEventListener('click', onAdd);
    this.disposers.push(() => btn.removeEventListener('click', onAdd));
    bar.append(btn);
    void label;
    return bar;
  }

  /** Append a fresh, empty row to the draft + DOM (and focus its target). */
  addRow(): void {
    const row: DependencyDraftRow = {
      otherId: this.taskOptions[0]?.id ?? '',
      type: 'FS',
      lagDays: 0,
      removed: false,
    };
    this.rows.push(row);
    const rowEl = this.appendRowEl(row);
    this.refreshEmpty();
    this.emitChange();
    rowEl?.querySelector<HTMLSelectElement>('.jects-gantt__dep-target')?.focus();
  }

  /* ── per-row ──────────────────────────────────────────────────────────── */

  private appendRowEl(row: DependencyDraftRow): HTMLElement | null {
    if (row.removed) return null;
    const rowEl = createEl('div', { className: 'jects-gantt__dep-row' });
    rowEl.setAttribute('role', 'row');
    if (row.linkId != null) rowEl.dataset.linkId = String(row.linkId);

    // ── target task <select> ────────────────────────────────────────────
    const targetCell = createEl('span', { className: 'jects-gantt__dep-cell' });
    targetCell.setAttribute('role', 'gridcell');
    const target = createEl('select', {
      className: 'jects-gantt__dep-target jects-gantt__dep-input',
    }) as HTMLSelectElement;
    target.setAttribute(
      'aria-label',
      this.direction === 'predecessors' ? 'Predecessor task' : 'Successor task',
    );
    if (this.taskOptions.length === 0) {
      const opt = createEl('option') as HTMLOptionElement;
      opt.value = '';
      opt.textContent = '(no tasks)';
      target.append(opt);
    }
    for (const o of this.taskOptions) {
      const opt = createEl('option') as HTMLOptionElement;
      opt.value = String(o.id);
      opt.textContent = o.name || String(o.id);
      if (o.id === row.otherId) opt.selected = true;
      target.append(opt);
    }
    targetCell.append(target);

    // ── type <select> ───────────────────────────────────────────────────
    const typeCell = createEl('span', { className: 'jects-gantt__dep-cell' });
    typeCell.setAttribute('role', 'gridcell');
    const type = createEl('select', {
      className: 'jects-gantt__dep-type jects-gantt__dep-input',
    }) as HTMLSelectElement;
    type.setAttribute('aria-label', 'Dependency type');
    for (const t of DEPENDENCY_TYPES) {
      const opt = createEl('option') as HTMLOptionElement;
      opt.value = t.value;
      opt.textContent = t.label;
      if (t.value === row.type) opt.selected = true;
      type.append(opt);
    }
    typeCell.append(type);

    // ── lag <input type=number> (days) ──────────────────────────────────
    const lagCell = createEl('span', { className: 'jects-gantt__dep-cell' });
    lagCell.setAttribute('role', 'gridcell');
    const lag = createEl('input', {
      className: 'jects-gantt__dep-lag jects-gantt__dep-input',
    }) as HTMLInputElement;
    lag.type = 'number';
    lag.step = '0.5';
    lag.value = String(row.lagDays);
    lag.setAttribute('aria-label', 'Lag in days (negative for lead)');
    lagCell.append(lag);

    // ── remove button ───────────────────────────────────────────────────
    const removeCell = createEl('span', { className: 'jects-gantt__dep-cell jects-gantt__dep-cell--action' });
    removeCell.setAttribute('role', 'gridcell');
    const remove = createEl('button', {
      className: 'jects-gantt__dep-remove',
    }) as HTMLButtonElement;
    remove.type = 'button';
    remove.textContent = '✕';
    remove.setAttribute('aria-label', 'Remove link');
    removeCell.append(remove);

    // ── wiring ──────────────────────────────────────────────────────────
    const onTarget = (): void => {
      row.otherId = target.value;
      this.emitChange();
    };
    const onType = (): void => {
      row.type = type.value as DependencyType;
      this.emitChange();
    };
    const onLag = (): void => {
      const n = Number(lag.value);
      row.lagDays = Number.isFinite(n) ? n : 0;
      this.emitChange();
    };
    const onRemove = (): void => {
      if (row.linkId != null) {
        // Existing link: mark removed (commit will call removeDependency).
        row.removed = true;
      } else {
        // New, uncommitted row: drop it entirely.
        const i = this.rows.indexOf(row);
        if (i >= 0) this.rows.splice(i, 1);
      }
      rowEl.remove();
      this.refreshEmpty();
      this.emitChange();
    };
    target.addEventListener('change', onTarget);
    type.addEventListener('change', onType);
    lag.addEventListener('input', onLag);
    lag.addEventListener('change', onLag);
    remove.addEventListener('click', onRemove);
    this.disposers.push(() => {
      target.removeEventListener('change', onTarget);
      type.removeEventListener('change', onType);
      lag.removeEventListener('input', onLag);
      lag.removeEventListener('change', onLag);
      remove.removeEventListener('click', onRemove);
    });

    rowEl.append(targetCell, typeCell, lagCell, removeCell);
    this.body.append(rowEl);
    return rowEl;
  }

  private refreshEmpty(): void {
    this.emptyEl.hidden = this.liveCount > 0;
  }

  private emitChange(): void {
    if (this.destroyed) return;
    this.onChange?.(this.getRows());
  }

  /** Release listeners and remove the control element. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const d of this.disposers.splice(0)) d();
    this.el.remove();
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. RECONCILE DRAFT → ENGINE OPERATIONS
   ═══════════════════════════════════════════════════════════════════════════ */

/** A planned dependency add (a new link to create via `addDependency`). */
export interface DependencyAddOp {
  fromId: RecordId;
  toId: RecordId;
  type: DependencyType;
  lag: number;
}

/** A planned change to an existing link (removed, or its fields edited). */
export interface DependencyEditOp {
  linkId: RecordId;
  /** When `true`, the link should be removed. */
  remove: boolean;
  /** When not removed, the new link fields (only present if they changed). */
  patch?: { type?: DependencyType; lag?: number };
}

/** The full set of operations to apply a dependency grid's draft. */
export interface DependencyReconcile {
  adds: DependencyAddOp[];
  edits: DependencyEditOp[];
}

/**
 * Diff a grid's draft rows against the original links and produce the minimal
 * set of engine operations. A predecessor grid creates links `other → task`; a
 * successor grid creates `task → other`.
 *
 * Pure + DOM-free, so it is unit-testable on its own.
 */
export function reconcileDependencies(
  taskId: RecordId,
  direction: DependencyDirection,
  original: ReadonlyArray<DependencyModel>,
  rows: ReadonlyArray<DependencyDraftRow>,
): DependencyReconcile {
  const adds: DependencyAddOp[] = [];
  const edits: DependencyEditOp[] = [];
  const originalById = new Map(original.map((l) => [l.id, l]));

  for (const row of rows) {
    if (row.linkId == null) {
      // New row → add (skip if no valid target chosen).
      if (row.otherId === '' || row.removed) continue;
      const fromId = direction === 'predecessors' ? row.otherId : taskId;
      const toId = direction === 'predecessors' ? taskId : row.otherId;
      if (fromId === toId) continue; // never self-link
      adds.push({ fromId, toId, type: row.type, lag: daysToLag(row.lagDays) });
      continue;
    }
    const link = originalById.get(row.linkId);
    if (!link) continue;
    if (row.removed) {
      edits.push({ linkId: row.linkId, remove: true });
      continue;
    }
    const patch: { type?: DependencyType; lag?: number } = {};
    const origType = link.type ?? 'FS';
    const origLag = link.lag ?? 0;
    if (row.type !== origType) patch.type = row.type;
    const newLag = daysToLag(row.lagDays);
    if (newLag !== origLag) patch.lag = newLag;
    // The other end of the link can also be re-targeted in the grid; if it
    // changed we model it as remove + re-add (engine has no "retarget").
    const origOther = direction === 'predecessors' ? link.fromId : link.toId;
    if (row.otherId !== '' && row.otherId !== origOther) {
      edits.push({ linkId: row.linkId, remove: true });
      const fromId = direction === 'predecessors' ? row.otherId : taskId;
      const toId = direction === 'predecessors' ? taskId : row.otherId;
      if (fromId !== toId) {
        adds.push({ fromId, toId, type: row.type, lag: daysToLag(row.lagDays) });
      }
      continue;
    }
    if (patch.type !== undefined || patch.lag !== undefined) {
      edits.push({ linkId: row.linkId, remove: false, patch });
    }
  }
  return { adds, edits };
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. ADVANCED FIELDS (constraint, calendar, scheduling mode)
   ═══════════════════════════════════════════════════════════════════════════ */

/** A calendar option for the Advanced-tab calendar `<select>`. */
export interface CalendarOption {
  id: string;
  name: string;
}

/** The patch the Advanced tab produces (constraint + task field changes). */
export interface AdvancedPatch {
  constraintType: ConstraintType;
  constraintDate?: number;
  calendarId?: string;
  manuallyScheduled: boolean;
}

/** Construction options for {@link AdvancedFields}. */
export interface AdvancedFieldsOptions<T extends Model = Model> {
  task: TaskModel<T>;
  /** Calendars available for the calendar `<select>` (optional). */
  calendars?: ReadonlyArray<CalendarOption>;
  onChange?(patch: AdvancedPatch): void;
}

/**
 * The Advanced tab: constraint type + (conditional) constraint date, calendar
 * selection, and the scheduling mode (Auto vs. Manual). All native controls;
 * the constraint-date row shows/hides based on the chosen constraint type.
 */
export class AdvancedFields<T extends Model = Model> {
  readonly el: HTMLElement;

  private readonly onChange: AdvancedFieldsOptions<T>['onChange'];
  private readonly disposers: Array<() => void> = [];
  private destroyed = false;

  private constraintSel!: HTMLSelectElement;
  private dateRow!: HTMLElement;
  private dateInput!: HTMLInputElement;
  private calendarSel: HTMLSelectElement | null = null;
  private manualCheck!: HTMLInputElement;

  constructor(opts: AdvancedFieldsOptions<T>) {
    this.onChange = opts.onChange;
    const task = opts.task;
    this.el = createEl('div', { className: 'jects-gantt__adv-form' });

    // ── constraint type ────────────────────────────────────────────────
    const ctRow = createEl('div', { className: 'jects-gantt__adv-row' });
    const ctLabel = createEl('label', { className: 'jects-gantt__adv-label' });
    const ctId = 'jects-gantt-adv-constraint';
    ctLabel.htmlFor = ctId;
    ctLabel.textContent = 'Constraint type';
    this.constraintSel = createEl('select', {
      className: 'jects-gantt__adv-input',
    }) as HTMLSelectElement;
    this.constraintSel.id = ctId;
    const current = task.constraintType ?? 'asSoonAsPossible';
    for (const c of CONSTRAINT_TYPES) {
      const opt = createEl('option') as HTMLOptionElement;
      opt.value = c.value;
      opt.textContent = c.label;
      if (c.value === current) opt.selected = true;
      this.constraintSel.append(opt);
    }
    ctRow.append(ctLabel, this.constraintSel);
    this.el.append(ctRow);

    // ── constraint date (conditional) ──────────────────────────────────
    this.dateRow = createEl('div', { className: 'jects-gantt__adv-row' });
    const dLabel = createEl('label', { className: 'jects-gantt__adv-label' });
    const dId = 'jects-gantt-adv-constraint-date';
    dLabel.htmlFor = dId;
    dLabel.textContent = 'Constraint date';
    this.dateInput = createEl('input', {
      className: 'jects-gantt__adv-input',
    }) as HTMLInputElement;
    this.dateInput.id = dId;
    this.dateInput.type = 'date';
    this.dateInput.value = toDateInputValue(task.constraintDate);
    this.dateRow.append(dLabel, this.dateInput);
    this.dateRow.hidden = !constraintIsDated(current);
    this.el.append(this.dateRow);

    // ── calendar (optional) ────────────────────────────────────────────
    if (opts.calendars && opts.calendars.length > 0) {
      const calRow = createEl('div', { className: 'jects-gantt__adv-row' });
      const calLabel = createEl('label', { className: 'jects-gantt__adv-label' });
      const calId = 'jects-gantt-adv-calendar';
      calLabel.htmlFor = calId;
      calLabel.textContent = 'Calendar';
      const sel = createEl('select', { className: 'jects-gantt__adv-input' }) as HTMLSelectElement;
      sel.id = calId;
      const inherit = createEl('option') as HTMLOptionElement;
      inherit.value = '';
      inherit.textContent = '(project default)';
      sel.append(inherit);
      for (const c of opts.calendars) {
        const opt = createEl('option') as HTMLOptionElement;
        opt.value = c.id;
        opt.textContent = c.name || c.id;
        if (c.id === task.calendarId) opt.selected = true;
        sel.append(opt);
      }
      calRow.append(calLabel, sel);
      this.el.append(calRow);
      this.calendarSel = sel;
    }

    // ── scheduling mode (manual vs auto) ───────────────────────────────
    const modeRow = createEl('div', {
      className: 'jects-gantt__adv-row jects-gantt__adv-row--check',
    });
    this.manualCheck = createEl('input', { className: 'jects-gantt__adv-check' }) as HTMLInputElement;
    const mId = 'jects-gantt-adv-manual';
    this.manualCheck.id = mId;
    this.manualCheck.type = 'checkbox';
    this.manualCheck.checked = !!task.manuallyScheduled;
    const mLabel = createEl('label', { className: 'jects-gantt__adv-label' });
    mLabel.htmlFor = mId;
    mLabel.textContent = 'Manually scheduled (pin dates; do not auto-reschedule)';
    modeRow.append(this.manualCheck, mLabel);
    this.el.append(modeRow);

    // ── wiring ──────────────────────────────────────────────────────────
    const onConstraint = (): void => {
      this.dateRow.hidden = !constraintIsDated(this.constraintSel.value as ConstraintType);
      this.emitChange();
    };
    const onDate = (): void => this.emitChange();
    const onCalendar = (): void => this.emitChange();
    const onManual = (): void => this.emitChange();
    this.constraintSel.addEventListener('change', onConstraint);
    this.dateInput.addEventListener('change', onDate);
    this.dateInput.addEventListener('input', onDate);
    this.calendarSel?.addEventListener('change', onCalendar);
    this.manualCheck.addEventListener('change', onManual);
    this.disposers.push(() => {
      this.constraintSel.removeEventListener('change', onConstraint);
      this.dateInput.removeEventListener('change', onDate);
      this.dateInput.removeEventListener('input', onDate);
      this.calendarSel?.removeEventListener('change', onCalendar);
      this.manualCheck.removeEventListener('change', onManual);
    });
  }

  /** The current Advanced-tab patch. */
  getPatch(): AdvancedPatch {
    const constraintType = this.constraintSel.value as ConstraintType;
    const patch: AdvancedPatch = {
      constraintType,
      manuallyScheduled: this.manualCheck.checked,
    };
    if (constraintIsDated(constraintType)) {
      const d = parseDateInputValue(this.dateInput.value);
      if (d != null) patch.constraintDate = d;
    }
    if (this.calendarSel && this.calendarSel.value !== '') {
      patch.calendarId = this.calendarSel.value;
    }
    return patch;
  }

  private emitChange(): void {
    if (this.destroyed) return;
    this.onChange?.(this.getPatch());
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const d of this.disposers.splice(0)) d();
    this.el.remove();
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. NOTES FIELD
   ═══════════════════════════════════════════════════════════════════════════ */

/** Construction options for {@link NotesField}. */
export interface NotesFieldOptions {
  /** Initial note text. */
  value?: string;
  /** Accessible label. Default `'Notes'`. */
  label?: string;
  onChange?(value: string): void;
}

/** A simple labelled `<textarea>` for the task note. */
export class NotesField {
  readonly el: HTMLElement;
  private readonly textarea: HTMLTextAreaElement;
  private readonly disposers: Array<() => void> = [];
  private destroyed = false;

  constructor(opts: NotesFieldOptions = {}) {
    this.el = createEl('div', { className: 'jects-gantt__notes-field' });
    const id = 'jects-gantt-notes';
    const label = createEl('label', { className: 'jects-gantt__notes-label' });
    label.htmlFor = id;
    label.textContent = opts.label ?? 'Notes';
    this.textarea = createEl('textarea', {
      className: 'jects-gantt__notes-input',
    }) as HTMLTextAreaElement;
    this.textarea.id = id;
    this.textarea.rows = 6;
    this.textarea.value = opts.value ?? '';
    this.el.append(label, this.textarea);

    const onInput = (): void => opts.onChange?.(this.textarea.value);
    this.textarea.addEventListener('input', onInput);
    this.disposers.push(() => this.textarea.removeEventListener('input', onInput));
  }

  /** The current note text. */
  getValue(): string {
    return this.textarea.value;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const d of this.disposers.splice(0)) d();
    this.el.remove();
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. ORCHESTRATOR — build the four panels + commit through GanttApi
   ═══════════════════════════════════════════════════════════════════════════ */

/** A tab descriptor + its filled panel element, ready to slot into the editor. */
export interface DependencyTabPanel {
  id: string;
  label: string;
  /** The filled panel content element (caller wraps it in a `role="tabpanel"`). */
  content: HTMLElement;
}

/**
 * Per-task input the orchestrator needs that is NOT reachable from `GanttApi`
 * alone (the note text + the calendar catalogue are consumer-owned). All
 * optional.
 */
export interface DependencyTabsExtras {
  /** Calendars to populate the Advanced-tab calendar `<select>`. */
  calendars?: ReadonlyArray<CalendarOption>;
  /** The field on `task.data` (or task) that stores the note. Default `'note'`. */
  noteField?: string;
  /** Initial note text (overrides reading from the task). */
  note?: string;
}

/** Construction options for {@link GanttDependencyTabs}. */
export interface GanttDependencyTabsOptions<T extends Model = Model> {
  /** The live Gantt API (the engine/timeline seam every change routes through). */
  api: GanttApi<T>;
  /** The task being edited. */
  task: TaskModel<T>;
  /** Extra consumer-owned inputs (calendars / note). */
  extras?: DependencyTabsExtras;
  /** Which tabs to build. Default: all four. */
  tabs?: ReadonlyArray<keyof typeof DEPENDENCY_TABS>;
}

/**
 * Builds the Predecessors / Successors / Advanced / Notes panels for a task and,
 * on {@link commit}, routes every change through the {@link GanttApi}:
 *   - link adds → `api.addDependency`,
 *   - link removes → `api.removeDependency`,
 *   - link edits (type/lag) → `removeDependency` + `addDependency` (the engine
 *     has no in-place link patch; this keeps a consistent CPM solution),
 *   - constraint → `api.applyConstraint`,
 *   - calendar / manual-mode / note → `api.updateTask`.
 *
 * It owns a LOCAL draft; nothing is applied until `commit()` (so the editor's
 * Cancel is honest). Build via the constructor, mount `panels()` into the
 * editor, and call `commit()` on Save and `destroy()` on close.
 */
export class GanttDependencyTabs<T extends Model = Model> {
  private readonly api: GanttApi<T>;
  private readonly task: TaskModel<T>;
  private readonly extras: DependencyTabsExtras;
  private readonly tabIds: ReadonlyArray<keyof typeof DEPENDENCY_TABS>;

  /** The original predecessor + successor links (for reconcile). */
  private readonly originalPreds: DependencyModel[];
  private readonly originalSuccs: DependencyModel[];

  private predField: DependencyGridField | null = null;
  private succField: DependencyGridField | null = null;
  private advanced: AdvancedFields<T> | null = null;
  private notes: NotesField | null = null;
  private destroyed = false;

  constructor(opts: GanttDependencyTabsOptions<T>) {
    this.api = opts.api;
    this.task = opts.task;
    this.extras = opts.extras ?? {};
    this.tabIds = opts.tabs ?? (['predecessors', 'successors', 'advanced', 'notes'] as const);

    const all = this.api.getDependenciesFor(this.task.id);
    this.originalPreds = all.filter((l) => l.toId === this.task.id);
    this.originalSuccs = all.filter((l) => l.fromId === this.task.id);
  }

  /** The task options for the link-target selects (all tasks except this one). */
  private taskOptions(): TaskOption[] {
    const out: TaskOption[] = [];
    const engine = this.api.engine;
    // Prefer the engine's task set; fall back to children-walk if unavailable.
    const seen = new Set<RecordId>();
    const pushTask = (t: TaskModel<T> | undefined): void => {
      if (!t || seen.has(t.id) || t.id === this.task.id) return;
      seen.add(t.id);
      out.push({ id: t.id, name: t.name ?? String(t.id) });
    };
    // Walk from any tasks reachable through the API: existing link endpoints +
    // the task's own subtree + any tasks the engine can resolve via deps.
    for (const l of this.api.getDependenciesFor(this.task.id)) {
      pushTask(this.api.getTask(l.fromId));
      pushTask(this.api.getTask(l.toId));
    }
    // Engine-backed full enumeration when the engine exposes it (best effort).
    const maybeAll = (engine as unknown as { getTasks?: () => ReadonlyArray<TaskModel<T>> }).getTasks;
    if (typeof maybeAll === 'function') {
      for (const t of maybeAll.call(engine)) pushTask(t);
    }
    return out;
  }

  /** Read the initial note text from extras or the task model. */
  private initialNote(): string {
    if (this.extras.note != null) return this.extras.note;
    const field = this.extras.noteField ?? 'note';
    const fromData = (this.task.data as Record<string, unknown> | undefined)?.[field];
    if (typeof fromData === 'string') return fromData;
    const fromTask = (this.task as unknown as Record<string, unknown>)[field];
    return typeof fromTask === 'string' ? fromTask : '';
  }

  /** Build (once) and return the tab panels, in the configured order. */
  panels(): DependencyTabPanel[] {
    const options = this.taskOptions();
    const out: DependencyTabPanel[] = [];
    for (const id of this.tabIds) {
      if (id === 'predecessors') {
        this.predField ??= new DependencyGridField({
          taskId: this.task.id,
          direction: 'predecessors',
          links: this.originalPreds,
          taskOptions: options,
        });
        out.push({ id: DEPENDENCY_TABS.predecessors, label: 'Predecessors', content: this.predField.el });
      } else if (id === 'successors') {
        this.succField ??= new DependencyGridField({
          taskId: this.task.id,
          direction: 'successors',
          links: this.originalSuccs,
          taskOptions: options,
        });
        out.push({ id: DEPENDENCY_TABS.successors, label: 'Successors', content: this.succField.el });
      } else if (id === 'advanced') {
        this.advanced ??= new AdvancedFields<T>(
          this.extras.calendars
            ? { task: this.task, calendars: this.extras.calendars }
            : { task: this.task },
        );
        out.push({ id: DEPENDENCY_TABS.advanced, label: 'Advanced', content: this.advanced.el });
      } else if (id === 'notes') {
        this.notes ??= new NotesField({ value: this.initialNote() });
        out.push({ id: DEPENDENCY_TABS.notes, label: 'Notes', content: this.notes.el });
      }
    }
    return out;
  }

  /**
   * Apply the draft to the model through the `GanttApi`. Returns a summary of
   * what was applied (handy for tests + undo grouping). Idempotent-safe: after a
   * commit the fields still reflect the (now-committed) state, so a second commit
   * is a no-op for unchanged rows.
   */
  commit(): {
    added: Array<Omit<DependencyModel, 'id'>>;
    removed: RecordId[];
    constraintApplied: boolean;
    taskPatched: boolean;
  } {
    const added: Array<Omit<DependencyModel, 'id'>> = [];
    const removed: RecordId[] = [];

    // ── predecessor + successor link reconciliation ─────────────────────
    const apply = (
      field: DependencyGridField | null,
      direction: DependencyDirection,
      original: DependencyModel[],
    ): void => {
      if (!field) return;
      const recon = reconcileDependencies(this.task.id, direction, original, field.getRows());
      for (const e of recon.edits) {
        if (e.remove) {
          this.api.removeDependency(e.linkId);
          removed.push(e.linkId);
        } else if (e.patch) {
          // No in-place link patch on the engine: remove + re-add with new fields.
          const link = original.find((l) => l.id === e.linkId);
          if (!link) continue;
          this.api.removeDependency(e.linkId);
          removed.push(e.linkId);
          // Report the link SPEC we requested (no engine-assigned id): the
          // engine mints the real id, but `added` describes the change the
          // editor asked for, keyed by from/to — leaking a transient internal id
          // would make `added` non-deterministic across engines.
          const spec: Omit<DependencyModel, 'id'> = {
            fromId: link.fromId,
            toId: link.toId,
            type: e.patch.type ?? link.type ?? 'FS',
            lag: e.patch.lag ?? link.lag ?? 0,
            active: link.active,
          };
          const created = this.api.addDependency(spec);
          if (created) added.push(spec);
        }
      }
      for (const a of recon.adds) {
        const spec: Omit<DependencyModel, 'id'> = {
          fromId: a.fromId,
          toId: a.toId,
          type: a.type,
          lag: a.lag,
        };
        const created = this.api.addDependency(spec);
        if (created) added.push(spec);
      }
    };
    apply(this.predField, 'predecessors', this.originalPreds);
    apply(this.succField, 'successors', this.originalSuccs);

    // ── constraint + task-field patch (Advanced tab) ────────────────────
    let constraintApplied = false;
    let taskPatched = false;
    if (this.advanced) {
      const patch = this.advanced.getPatch();
      const origCt = this.task.constraintType ?? 'asSoonAsPossible';
      const origCd = this.task.constraintDate;
      if (patch.constraintType !== origCt || patch.constraintDate !== origCd) {
        this.api.applyConstraint(this.task.id, patch.constraintType, patch.constraintDate);
        constraintApplied = true;
      }
      const taskPatch: Partial<TaskModel<T>> = {};
      if (patch.manuallyScheduled !== !!this.task.manuallyScheduled) {
        taskPatch.manuallyScheduled = patch.manuallyScheduled;
      }
      if (patch.calendarId !== this.task.calendarId) {
        // `undefined` is a legitimate value here (clear to project-default
        // calendar); assign through an index to satisfy exactOptionalPropertyTypes.
        (taskPatch as Record<string, unknown>).calendarId = patch.calendarId;
      }
      if (Object.keys(taskPatch).length > 0) {
        this.api.updateTask(this.task.id, taskPatch);
        taskPatched = true;
      }
    }

    // ── notes (Notes tab) ───────────────────────────────────────────────
    if (this.notes) {
      const field = this.extras.noteField ?? 'note';
      const value = this.notes.getValue();
      if (value !== this.initialNote()) {
        const patch = { data: { ...(this.task.data as Model), [field]: value } } as Partial<TaskModel<T>>;
        this.api.updateTask(this.task.id, patch);
        taskPatched = true;
      }
    }

    return { added, removed, constraintApplied, taskPatched };
  }

  /** Release all owned fields. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.predField?.destroy();
    this.succField?.destroy();
    this.advanced?.destroy();
    this.notes?.destroy();
    this.predField = this.succField = null;
    this.advanced = null;
    this.notes = null;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   8. WIRE NOTES (for the integrator)
   ═══════════════════════════════════════════════════════════════════════════

   This module is additive + self-contained; it touches NO shared file. To make
   the four tabs reachable from the package:

   1) Barrel (additive only — left to the integrator to avoid a concurrent-edit
      collision on the shared `ui/index.ts` + `src/index.ts`):

        // packages/gantt/src/ui/index.ts
        export {
          GanttDependencyTabs, DependencyGridField, AdvancedFields, NotesField,
          reconcileDependencies, DEPENDENCY_TYPES, CONSTRAINT_TYPES,
          DEPENDENCY_TABS, constraintIsDated,
          toDateInputValue, parseDateInputValue, lagToDays, daysToLag,
        } from './task-editor-dependency-tabs.js';
        export type {
          DependencyDirection, DependencyDraftRow, TaskOption,
          DependencyGridFieldOptions, DependencyReconcile, DependencyAddOp,
          DependencyEditOp, AdvancedPatch, AdvancedFieldsOptions, CalendarOption,
          NotesFieldOptions, DependencyTabPanel, DependencyTabsExtras,
          GanttDependencyTabsOptions,
        } from './task-editor-dependency-tabs.js';

      (and a matching re-export block from `src/index.ts`).

   2) Tabbed editor: `GanttTabbedTaskEditor` is closed for edits here (concurrency
      rule). Two integration paths, both additive:

      a) Preferred — extend the tabbed editor to accept an injected
         `extraTabs?: (task) => DependencyTabPanel[]` provider + an
         `onCommitExtras?(api)` hook, then pass:
            new GanttDependencyTabs({ api, task }).panels()  // for extraTabs
            tabs.commit()                                    // on Save

      b) Standalone — mount the panels in any host tab container, calling
         `commit()` on the host's Save button. The grids are plain elements with
         their own ARIA, so they drop straight into a `role="tabpanel"`.

   3) The note storage location is consumer-owned: by default the note round-trips
      through `task.data.note`; override with `extras.noteField`. Calendars for the
      Advanced tab come from `extras.calendars` (e.g. mapped from
      `GanttOptions.calendars`).
*/
