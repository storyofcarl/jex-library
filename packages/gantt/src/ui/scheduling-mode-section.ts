/**
 * `scheduling-mode-section` — a self-contained **Advanced** editor section that
 * brings the Gantt task editor to Bryntum/DHTMLX parity for *per-task scheduling
 * mode*, plus the default **today / status** {@link ProjectLine} that the
 * ProjectLines surface ships out of the box.
 *
 * Where the existing task editor exposes only the General fields (name / dates /
 * duration / %done / milestone) and — when an effort-aware engine is wired — an
 * `effortDriven` toggle, Bryntum's TaskEditor "Advanced" tab additionally lets a
 * planner pick, per task:
 *   - the **scheduling mode**: Auto-scheduled (the engine computes dates from
 *     dependencies + constraints) vs **Manually scheduled** (the bar is pinned to
 *     its `start`/`end` and only constraint clamping applies);
 *   - the **scheduling direction** for an auto task: **ASAP** (As Soon As
 *     Possible — forward) vs **ALAP** (As Late As Possible — backward), surfaced
 *     as the two direction-style {@link ConstraintType}s;
 *   - the **constraint type** (+ a conditional **constraint date** for the dated
 *     constraints) anchoring the task; and
 *   - the **effort-driven** flag (whether duration is derived from
 *     `effort / Σ units`).
 *
 * This module supplies that whole section as ONE framework-free control —
 * {@link SchedulingModeSection} — that:
 *   - edits a LOCAL draft (nothing reaches the model until the consumer reads
 *     {@link SchedulingModeSection.getPatch} on Save), so a host editor's Cancel
 *     stays honest;
 *   - produces a fully-typed {@link SchedulingModePatch} that maps 1-for-1 onto
 *     the engine's edit seam (`api.applyConstraint` for the constraint and
 *     `api.updateTask` for `manuallyScheduled` / `effortDriven`); and
 *   - fires a typed `change` whenever the draft changes, so a host can preview.
 *
 * Design (concurrency-safe, contract-pure — same discipline as the rest of the
 * task-editor feature set):
 *   - NEW, additive module. It does NOT edit `GanttTaskEditor`,
 *     `GanttTabbedTaskEditor`, `task-editor-dependency-tabs`, the `Gantt` class,
 *     the package barrel, or any shared config. The integrator wires it into the
 *     editor (see the WIRE NOTES at the foot of this file).
 *   - It does NOT depend on `@jects/widgets`: every field is a native
 *     `<select>` / `<input>`, so it works in the jsdom editor body and in the
 *     jsdom unit tests without the widgets build (which evolves concurrently).
 *   - The section is a labelled `group` (`role="group"` + `aria-labelledby`) of
 *     native, individually-labelled controls. Toggling the mode disables the
 *     direction/constraint controls (a manually-scheduled task ignores them) and
 *     the constraint-date row appears only for a dated constraint — so axe passes
 *     with zero serious/critical violations and the whole section is keyboard
 *     operable.
 *
 * All token-pure CSS lives in `scheduling-mode-section.css` (no hardcoded
 * colours; `@layer jects.components`).
 */

import './scheduling-mode-section.css';
import { createEl, type Model, type RecordId } from '@jects/core';
import type { TaskModel, ConstraintType, ScheduleDirection } from '../contract.js';
import type { ProjectLine } from './project-lines.js';

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;
const DEFAULT_HOURS_PER_DAY = 8;

/* ═══════════════════════════════════════════════════════════════════════════
   1. VOCAB — scheduling mode / direction / constraints
   ═══════════════════════════════════════════════════════════════════════════ */

/** The per-task scheduling mode: engine-driven vs pinned. */
export type SchedulingMode = 'auto' | 'manual';

/**
 * The two *direction-style* constraint types, surfaced as the ASAP/ALAP choice.
 * `asSoonAsPossible` schedules forward from the project start; `asLateAsPossible`
 * schedules backward from the project deadline.
 */
export const SCHEDULING_DIRECTIONS: ReadonlyArray<{
  value: Extract<ConstraintType, 'asSoonAsPossible' | 'asLateAsPossible'>;
  direction: ScheduleDirection;
  label: string;
}> = [
  { value: 'asSoonAsPossible', direction: 'forward', label: 'As Soon As Possible (ASAP)' },
  { value: 'asLateAsPossible', direction: 'backward', label: 'As Late As Possible (ALAP)' },
];

/** The full set of constraint types, in editor display order, with labels. */
export const CONSTRAINT_TYPE_OPTIONS: ReadonlyArray<{
  value: ConstraintType;
  label: string;
  /** Whether the constraint carries a date operand (shows the date row). */
  dated: boolean;
  /** Whether the constraint is a "direction" choice (ASAP/ALAP, dateless). */
  direction: boolean;
}> = [
  { value: 'asSoonAsPossible', label: 'As Soon As Possible (ASAP)', dated: false, direction: true },
  { value: 'asLateAsPossible', label: 'As Late As Possible (ALAP)', dated: false, direction: true },
  { value: 'startNoEarlierThan', label: 'Start No Earlier Than', dated: true, direction: false },
  { value: 'startNoLaterThan', label: 'Start No Later Than', dated: true, direction: false },
  { value: 'finishNoEarlierThan', label: 'Finish No Earlier Than', dated: true, direction: false },
  { value: 'finishNoLaterThan', label: 'Finish No Later Than', dated: true, direction: false },
  { value: 'mustStartOn', label: 'Must Start On', dated: true, direction: false },
  { value: 'mustFinishOn', label: 'Must Finish On', dated: true, direction: false },
];

/** Whether a constraint type carries a date operand. */
export function constraintTypeIsDated(type: ConstraintType): boolean {
  return CONSTRAINT_TYPE_OPTIONS.find((c) => c.value === type)?.dated ?? false;
}

/** Whether a constraint type is one of the dateless ASAP/ALAP direction choices. */
export function constraintTypeIsDirection(type: ConstraintType): boolean {
  return CONSTRAINT_TYPE_OPTIONS.find((c) => c.value === type)?.direction ?? false;
}

/** The {@link ScheduleDirection} a direction-style constraint corresponds to. */
export function directionForConstraint(type: ConstraintType): ScheduleDirection {
  return type === 'asLateAsPossible' ? 'backward' : 'forward';
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. PURE HELPERS (date <-> input value, effort <-> person-days)
   ═══════════════════════════════════════════════════════════════════════════ */

/** A `Date`/epoch-ms → `yyyy-mm-dd` value for a native `<input type="date">`. */
export function toDateFieldValue(ms?: number): string {
  if (ms == null || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse a native date input value back to epoch ms (UTC), or `undefined`. */
export function parseDateFieldValue(value?: string): number | undefined {
  if (value == null || value === '') return undefined;
  const t = Date.parse(value);
  return Number.isNaN(t) ? undefined : t;
}

/** Working-ms effort → person-days (rounded to 2dp), for the editor's input. */
export function effortToPersonDays(effort?: number, hoursPerDay = DEFAULT_HOURS_PER_DAY): number {
  if (effort == null || !Number.isFinite(effort)) return 0;
  const hpd = hoursPerDay > 0 ? hoursPerDay : DEFAULT_HOURS_PER_DAY;
  return Math.round((effort / MS_PER_HOUR / hpd) * 100) / 100;
}

/** Person-days → working-ms effort (the inverse of {@link effortToPersonDays}). */
export function personDaysToEffort(days: number, hoursPerDay = DEFAULT_HOURS_PER_DAY): number {
  if (!Number.isFinite(days) || days < 0) return 0;
  const hpd = hoursPerDay > 0 ? hoursPerDay : DEFAULT_HOURS_PER_DAY;
  return Math.max(0, Math.round(days * hpd * MS_PER_HOUR));
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. PATCH MODEL
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The typed patch the Advanced scheduling section produces. It maps directly onto
 * the engine edit seam:
 *   - `constraintType` (+ `constraintDate` when dated) → `api.applyConstraint`,
 *   - `manuallyScheduled` / `effortDriven` (+ `effort`) → `api.updateTask`.
 */
export interface SchedulingModePatch {
  /** The chosen scheduling mode. */
  mode: SchedulingMode;
  /** `true` when `mode === 'manual'` (pin dates; do not auto-reschedule). */
  manuallyScheduled: boolean;
  /** The constraint anchoring the task (ASAP/ALAP for an auto task by default). */
  constraintType: ConstraintType;
  /** The constraint date operand, present only for a dated constraint. */
  constraintDate?: number;
  /** Whether the task's duration is derived from `effort / Σ units`. */
  effortDriven: boolean;
  /** Total effort in working ms (present only when the effort field is shown). */
  effort?: number;
}

/** A summary of what changed vs the task's original values (handy for tests). */
export interface SchedulingModeDiff {
  /** The constraint changed (type and/or date) → caller should applyConstraint. */
  constraintChanged: boolean;
  /** `manuallyScheduled` changed. */
  manualChanged: boolean;
  /** `effortDriven` changed. */
  effortDrivenChanged: boolean;
  /** `effort` changed (only meaningful when the effort field is shown). */
  effortChanged: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. THE ADVANCED SCHEDULING-MODE SECTION CONTROL
   ═══════════════════════════════════════════════════════════════════════════ */

/** Construction options for {@link SchedulingModeSection}. */
export interface SchedulingModeSectionOptions<T extends Model = Model> {
  /** The task being edited (seeds the draft). */
  task: TaskModel<T>;
  /**
   * Show the effort-driven controls (an Effort field in person-days + the
   * Effort-driven toggle). Enable only when an effort-aware engine is wired.
   * Default `false`.
   */
  effortEnabled?: boolean;
  /** Working hours/day for the person-day ⇄ working-ms conversion. Default 8. */
  hoursPerDay?: number;
  /** Accessible heading for the section group. Default `'Advanced scheduling'`. */
  heading?: string;
  /** A stable id suffix (so multiple editors don't collide on element ids). */
  idSuffix?: string;
  /** Fired whenever the draft changes (mode / direction / constraint / effort). */
  onChange?(patch: SchedulingModePatch): void;
}

/**
 * A keyboard-accessible, framework-free **Advanced scheduling** section: a
 * scheduling-mode toggle (Auto vs Manual), a direction/constraint `<select>`
 * (ASAP/ALAP + the dated constraints) with a conditional constraint-date row,
 * and — when enabled — the effort + effort-driven controls.
 *
 * The control disables the direction/constraint controls while the task is
 * manually scheduled (a pinned bar ignores its constraint), keeping the UI honest
 * about what the engine will do.
 *
 * Lifecycle: `new SchedulingModeSection(opts)` → append `section.el` into the
 * editor panel → on Save read `section.getPatch()` (and optionally
 * `section.diff()`), route it through the `GanttApi`, then `section.destroy()`.
 */
export class SchedulingModeSection<T extends Model = Model> {
  /** The owned section element (caller appends it into the editor panel). */
  readonly el: HTMLElement;

  private readonly task: TaskModel<T>;
  private readonly effortEnabled: boolean;
  private readonly hoursPerDay: number;
  private readonly onChange: SchedulingModeSectionOptions<T>['onChange'];
  private readonly disposers: Array<() => void> = [];
  private destroyed = false;

  /** Snapshot of the task's original values, for {@link diff}. */
  private readonly original: {
    manuallyScheduled: boolean;
    constraintType: ConstraintType;
    constraintDate: number | undefined;
    effortDriven: boolean;
    effort: number | undefined;
  };

  private modeAuto!: HTMLInputElement;
  private modeManual!: HTMLInputElement;
  private constraintSel!: HTMLSelectElement;
  private dateRow!: HTMLElement;
  private dateInput!: HTMLInputElement;
  private effortInput: HTMLInputElement | null = null;
  private effortDrivenCheck: HTMLInputElement | null = null;

  constructor(opts: SchedulingModeSectionOptions<T>) {
    this.task = opts.task;
    this.effortEnabled = opts.effortEnabled ?? false;
    this.hoursPerDay =
      opts.hoursPerDay && opts.hoursPerDay > 0 ? opts.hoursPerDay : DEFAULT_HOURS_PER_DAY;
    this.onChange = opts.onChange;

    const suffix = opts.idSuffix ?? String(this.task.id);
    const constraintType = this.task.constraintType ?? 'asSoonAsPossible';

    this.original = {
      manuallyScheduled: !!this.task.manuallyScheduled,
      constraintType,
      constraintDate: this.task.constraintDate,
      effortDriven:
        (this.task as TaskModel<T> & { effortDriven?: boolean }).effortDriven === true,
      effort: this.task.effort,
    };

    // ── section container (a labelled group) ────────────────────────────
    this.el = createEl('section', { className: 'jects-gantt__sched-section' });
    this.el.setAttribute('role', 'group');
    const headingId = `jects-gantt-sched-heading-${suffix}`;
    this.el.setAttribute('aria-labelledby', headingId);

    const heading = createEl('h3', { className: 'jects-gantt__sched-heading' });
    heading.id = headingId;
    heading.textContent = opts.heading ?? 'Advanced scheduling';
    this.el.append(heading);

    // ── scheduling mode (Auto vs Manual) — a radiogroup ─────────────────
    const modeGroupId = `jects-gantt-sched-mode-${suffix}`;
    const modeFieldset = createEl('div', {
      className: 'jects-gantt__sched-row jects-gantt__sched-row--radiogroup',
    });
    modeFieldset.setAttribute('role', 'radiogroup');
    modeFieldset.setAttribute('aria-labelledby', `${modeGroupId}-label`);
    const modeLabel = createEl('span', { className: 'jects-gantt__sched-label' });
    modeLabel.id = `${modeGroupId}-label`;
    modeLabel.textContent = 'Scheduling mode';
    modeFieldset.append(modeLabel);

    const radioName = `${modeGroupId}-name`;
    this.modeAuto = this.buildModeRadio(
      `${modeGroupId}-auto`,
      radioName,
      'Auto-scheduled',
      !this.original.manuallyScheduled,
    );
    this.modeManual = this.buildModeRadio(
      `${modeGroupId}-manual`,
      radioName,
      'Manually scheduled',
      this.original.manuallyScheduled,
    );
    modeFieldset.append(this.modeAuto.parentElement!, this.modeManual.parentElement!);
    this.el.append(modeFieldset);

    // ── constraint type (incl. ASAP/ALAP direction) ─────────────────────
    const ctRow = createEl('div', { className: 'jects-gantt__sched-row' });
    const ctId = `jects-gantt-sched-constraint-${suffix}`;
    const ctLabel = createEl('label', { className: 'jects-gantt__sched-label' });
    ctLabel.htmlFor = ctId;
    ctLabel.textContent = 'Constraint / direction';
    this.constraintSel = createEl('select', {
      className: 'jects-gantt__sched-input',
    }) as HTMLSelectElement;
    this.constraintSel.id = ctId;
    for (const c of CONSTRAINT_TYPE_OPTIONS) {
      const opt = createEl('option') as HTMLOptionElement;
      opt.value = c.value;
      opt.textContent = c.label;
      if (c.value === constraintType) opt.selected = true;
      this.constraintSel.append(opt);
    }
    ctRow.append(ctLabel, this.constraintSel);
    this.el.append(ctRow);

    // ── constraint date (conditional on a dated constraint) ─────────────
    this.dateRow = createEl('div', { className: 'jects-gantt__sched-row' });
    const dId = `jects-gantt-sched-constraint-date-${suffix}`;
    const dLabel = createEl('label', { className: 'jects-gantt__sched-label' });
    dLabel.htmlFor = dId;
    dLabel.textContent = 'Constraint date';
    this.dateInput = createEl('input', {
      className: 'jects-gantt__sched-input',
    }) as HTMLInputElement;
    this.dateInput.id = dId;
    this.dateInput.type = 'date';
    this.dateInput.value = toDateFieldValue(this.original.constraintDate);
    this.dateRow.append(dLabel, this.dateInput);
    this.dateRow.hidden = !constraintTypeIsDated(constraintType);
    this.el.append(this.dateRow);

    // ── effort + effort-driven (conditional on an effort-aware engine) ──
    if (this.effortEnabled) {
      const effRow = createEl('div', { className: 'jects-gantt__sched-row' });
      const effId = `jects-gantt-sched-effort-${suffix}`;
      const effLabel = createEl('label', { className: 'jects-gantt__sched-label' });
      effLabel.htmlFor = effId;
      effLabel.textContent = 'Effort (days)';
      const effInput = createEl('input', {
        className: 'jects-gantt__sched-input',
      }) as HTMLInputElement;
      effInput.id = effId;
      effInput.type = 'number';
      effInput.min = '0';
      effInput.step = '0.25';
      effInput.value = String(effortToPersonDays(this.original.effort, this.hoursPerDay));
      effRow.append(effLabel, effInput);
      this.el.append(effRow);
      this.effortInput = effInput;

      const edRow = createEl('div', {
        className: 'jects-gantt__sched-row jects-gantt__sched-row--check',
      });
      const edId = `jects-gantt-sched-effort-driven-${suffix}`;
      const edCheck = createEl('input', { className: 'jects-gantt__sched-check' }) as HTMLInputElement;
      edCheck.id = edId;
      edCheck.type = 'checkbox';
      edCheck.checked = this.original.effortDriven;
      const edLabel = createEl('label', { className: 'jects-gantt__sched-label' });
      edLabel.htmlFor = edId;
      edLabel.textContent = 'Effort-driven (derive duration from effort ÷ units)';
      edRow.append(edCheck, edLabel);
      this.el.append(edRow);
      this.effortDrivenCheck = edCheck;
    }

    // ── wiring ──────────────────────────────────────────────────────────
    const onMode = (): void => {
      this.syncDisabled();
      this.emitChange();
    };
    const onConstraint = (): void => {
      this.dateRow.hidden = !constraintTypeIsDated(
        this.constraintSel.value as ConstraintType,
      );
      this.emitChange();
    };
    const onDate = (): void => this.emitChange();
    this.modeAuto.addEventListener('change', onMode);
    this.modeManual.addEventListener('change', onMode);
    this.constraintSel.addEventListener('change', onConstraint);
    this.dateInput.addEventListener('change', onDate);
    this.dateInput.addEventListener('input', onDate);
    this.disposers.push(() => {
      this.modeAuto.removeEventListener('change', onMode);
      this.modeManual.removeEventListener('change', onMode);
      this.constraintSel.removeEventListener('change', onConstraint);
      this.dateInput.removeEventListener('change', onDate);
      this.dateInput.removeEventListener('input', onDate);
    });
    if (this.effortInput) {
      const onEffort = (): void => this.emitChange();
      this.effortInput.addEventListener('change', onEffort);
      this.effortInput.addEventListener('input', onEffort);
      this.disposers.push(() => {
        this.effortInput?.removeEventListener('change', onEffort);
        this.effortInput?.removeEventListener('input', onEffort);
      });
    }
    if (this.effortDrivenCheck) {
      const onEd = (): void => this.emitChange();
      this.effortDrivenCheck.addEventListener('change', onEd);
      this.disposers.push(() =>
        this.effortDrivenCheck?.removeEventListener('change', onEd),
      );
    }

    // Initial disabled state (a manually-scheduled task ignores its constraint).
    this.syncDisabled();
  }

  /** The currently-chosen scheduling mode. */
  get mode(): SchedulingMode {
    return this.modeManual.checked ? 'manual' : 'auto';
  }

  /** The current draft as a typed patch. */
  getPatch(): SchedulingModePatch {
    const manuallyScheduled = this.modeManual.checked;
    const constraintType = this.constraintSel.value as ConstraintType;
    const patch: SchedulingModePatch = {
      mode: manuallyScheduled ? 'manual' : 'auto',
      manuallyScheduled,
      constraintType,
      effortDriven: this.effortDrivenCheck?.checked ?? this.original.effortDriven,
    };
    if (constraintTypeIsDated(constraintType)) {
      const d = parseDateFieldValue(this.dateInput.value);
      if (d != null) patch.constraintDate = d;
    }
    if (this.effortInput) {
      const days = Number(this.effortInput.value);
      patch.effort = personDaysToEffort(days, this.hoursPerDay);
    }
    return patch;
  }

  /** What changed vs the task's original values (for selective engine edits). */
  diff(): SchedulingModeDiff {
    const patch = this.getPatch();
    return {
      constraintChanged:
        patch.constraintType !== this.original.constraintType ||
        patch.constraintDate !== this.original.constraintDate,
      manualChanged: patch.manuallyScheduled !== this.original.manuallyScheduled,
      effortDrivenChanged:
        this.effortDrivenCheck != null && patch.effortDriven !== this.original.effortDriven,
      effortChanged:
        this.effortInput != null && (patch.effort ?? 0) !== (this.original.effort ?? 0),
    };
  }

  /* ── internals ────────────────────────────────────────────────────────── */

  private buildModeRadio(
    id: string,
    name: string,
    labelText: string,
    checked: boolean,
  ): HTMLInputElement {
    const wrap = createEl('div', { className: 'jects-gantt__sched-radio' });
    const input = createEl('input', { className: 'jects-gantt__sched-radio-input' }) as HTMLInputElement;
    input.type = 'radio';
    input.id = id;
    input.name = name;
    input.checked = checked;
    const label = createEl('label', { className: 'jects-gantt__sched-radio-label' });
    label.htmlFor = id;
    label.textContent = labelText;
    wrap.append(input, label);
    return input;
  }

  /**
   * A manually-scheduled task is pinned to its dates, so its direction/constraint
   * is moot — disable those controls (and the date row) while Manual is chosen,
   * so the UI never implies the engine will honour them.
   */
  private syncDisabled(): void {
    const manual = this.modeManual.checked;
    this.constraintSel.disabled = manual;
    this.dateInput.disabled = manual;
    this.el.classList.toggle('jects-gantt__sched-section--manual', manual);
  }

  private emitChange(): void {
    if (this.destroyed) return;
    this.onChange?.(this.getPatch());
  }

  /** Release listeners and remove the section element. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const d of this.disposers.splice(0)) d();
    this.el.remove();
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. DEFAULT TODAY / STATUS PROJECT LINE
   ═══════════════════════════════════════════════════════════════════════════ */

/** The id the default today/status line ships under. */
export const TODAY_LINE_ID = 'today';

/** Construction options for {@link defaultTodayLine}. */
export interface DefaultTodayLineOptions {
  /** The "now" instant the line marks (epoch ms). Default `Date.now()`. */
  now?: number;
  /** Override the marker id. Default {@link TODAY_LINE_ID}. */
  id?: string;
  /** Override the visible label. Default `'Today'`. */
  label?: string;
}

/**
 * The default **today / status** project line, snapped to the start of the day so
 * the marker sits on a clean date boundary (matching Bryntum's `TimeRanges`
 * current-time line + DHTMLX's `markerArea` today line). It is a normal
 * {@link ProjectLine} of kind `'today'`, so it paints with the today colour and
 * carries an accessible label — drop it into a `ProjectLines` set to ship a
 * today line out of the box.
 */
export function defaultTodayLine(opts: DefaultTodayLineOptions = {}): ProjectLine {
  const now = opts.now ?? Date.now();
  return {
    id: opts.id ?? TODAY_LINE_ID,
    date: startOfUtcDay(now),
    kind: 'today',
    label: opts.label ?? 'Today',
    labelSide: 'top',
  };
}

/**
 * The default project-line set shipped with the ProjectLines surface: the
 * today/status line, plus (when a project span is supplied) the project start +
 * finish boundary markers. Use as the `lines` seed for a `ProjectLines`
 * instance to match the Bryntum/DHTMLX out-of-the-box markers.
 */
export interface DefaultProjectLinesOptions extends DefaultTodayLineOptions {
  /** Include the today/status line. Default `true`. */
  today?: boolean;
  /** Include `projectStart`/`projectEnd` boundary lines. Default `false`. */
  projectBoundaries?: boolean;
}

/** Build the default project-line set (see {@link DefaultProjectLinesOptions}). */
export function defaultProjectLines(opts: DefaultProjectLinesOptions = {}): ProjectLine[] {
  const lines: ProjectLine[] = [];
  if (opts.today !== false) lines.push(defaultTodayLine(opts));
  if (opts.projectBoundaries) {
    lines.push(
      { id: 'project-start', anchor: 'projectStart', kind: 'start', label: 'Project start' },
      { id: 'project-end', anchor: 'projectEnd', kind: 'end', label: 'Project finish' },
    );
  }
  return lines;
}

/** Snap an epoch-ms instant down to the start of its UTC day. */
function startOfUtcDay(ms: number): number {
  return Math.floor(ms / MS_PER_DAY) * MS_PER_DAY;
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. ENGINE-EDIT MAPPING (apply a patch through the GanttApi, optional helper)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The minimal subset of the `GanttApi` the {@link applySchedulingModePatch}
 * helper needs. Declared structurally so a caller can pass the live `GanttApi`
 * (or a thin test double) without importing the whole surface.
 */
export interface SchedulingModeApi {
  applyConstraint(
    taskId: RecordId,
    constraintType: ConstraintType,
    constraintDate?: number,
  ): boolean;
  updateTask(taskId: RecordId, patch: Record<string, unknown>): boolean;
}

/**
 * Route a {@link SchedulingModePatch} through the engine edit seam, applying only
 * what changed (per {@link SchedulingModeSection.diff}):
 *   - the constraint (type + date) via `applyConstraint`, and
 *   - `manuallyScheduled` / `effortDriven` / `effort` via `updateTask`.
 *
 * Returns a flag for each branch actually applied (for undo grouping / tests).
 */
export function applySchedulingModePatch(
  api: SchedulingModeApi,
  taskId: RecordId,
  patch: SchedulingModePatch,
  diff: SchedulingModeDiff,
): { constraintApplied: boolean; taskPatched: boolean } {
  let constraintApplied = false;
  let taskPatched = false;

  if (diff.constraintChanged) {
    api.applyConstraint(taskId, patch.constraintType, patch.constraintDate);
    constraintApplied = true;
  }

  const taskPatch: Record<string, unknown> = {};
  if (diff.manualChanged) taskPatch.manuallyScheduled = patch.manuallyScheduled;
  if (diff.effortDrivenChanged) taskPatch.effortDriven = patch.effortDriven;
  if (diff.effortChanged && patch.effort != null) taskPatch.effort = patch.effort;
  if (Object.keys(taskPatch).length > 0) {
    api.updateTask(taskId, taskPatch);
    taskPatched = true;
  }

  return { constraintApplied, taskPatched };
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. WIRE NOTES (for the integrator)
   ═══════════════════════════════════════════════════════════════════════════

   This module is additive + self-contained; it touches NO shared file. To make
   the Advanced scheduling section + the default today line reachable from the
   package and wired into the editor:

   1) Barrel (additive only — left to the integrator to avoid a concurrent-edit
      collision on the shared `ui/index.ts` + `src/index.ts`):

        // packages/gantt/src/ui/index.ts
        export {
          SchedulingModeSection, applySchedulingModePatch,
          defaultTodayLine, defaultProjectLines,
          CONSTRAINT_TYPE_OPTIONS, SCHEDULING_DIRECTIONS, TODAY_LINE_ID,
          constraintTypeIsDated, constraintTypeIsDirection, directionForConstraint,
          toDateFieldValue, parseDateFieldValue,
          effortToPersonDays, personDaysToEffort,
        } from './scheduling-mode-section.js';
        export type {
          SchedulingMode, SchedulingModePatch, SchedulingModeDiff,
          SchedulingModeSectionOptions, SchedulingModeApi,
          DefaultTodayLineOptions, DefaultProjectLinesOptions,
        } from './scheduling-mode-section.js';

      (and a matching re-export block from `src/index.ts`).

   2) Task editor: mount the section in the General-tab panel (or as its own
      "Advanced" tab) of `GanttTabbedTaskEditor` / `GanttTaskEditor` — it is a
      plain element with its own ARIA, so it drops straight into a
      `role="tabpanel"` or below the form. On Save:

        const section = new SchedulingModeSection({ task, effortEnabled });
        // …editor mounts section.el…
        // on Save:
        applySchedulingModePatch(api, task.id, section.getPatch(), section.diff());

   3) Default today line: seed it into the ProjectLines set so a today/status line
      ships out of the box:

        const lines = new ProjectLines({
          axis: gantt.timeline.axis,
          lines: defaultProjectLines({ projectBoundaries: true }),
          projectSpan,
        });

      Refresh `defaultTodayLine()` on a day boundary (or on `scheduleChange`) if a
      live-advancing today line is desired.
*/
