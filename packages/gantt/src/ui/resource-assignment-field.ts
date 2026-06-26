/**
 * `ResourceAssignmentField` — the assignment EDITOR control: a keyboard-operable
 * multi-select of resources, each selected row carrying a per-assignment
 * **units %** input. This is the field the task editor mounts under a
 * "Resources" / "Assigned" section so a user can assign/unassign people and set
 * their allocation, exactly like the Bryntum task-editor "Resources" tab /
 * DHTMLX resource assignment dialog.
 *
 * Design (concurrency-safe, contract-pure):
 *   - It is a SELF-CONTAINED widget-like control with its own `el`, value model,
 *     and `change` callback. It does NOT depend on `@jects/widgets` (so it works
 *     in the jsdom editor body without the widgets build), and it does NOT edit
 *     the existing `GanttTaskEditor`. The task editor (or any consumer) mounts
 *     `field.el` into its form and reads `field.getValue()` on save, routing the
 *     result into the {@link AssignmentStore} via `setAssignmentsForTask`.
 *   - The control reads the resource catalogue + the task's current assignments
 *     from an {@link AssignmentStore}, but it edits a LOCAL draft: nothing is
 *     committed to the store until the consumer calls `commitTo(store, taskId)`
 *     (or applies `getValue()` itself). This keeps the editor's Cancel honest.
 *   - Fully accessible: a labelled group of checkboxes (assign toggles) each with
 *     an associated units spinbutton; the whole control is keyboard operable and
 *     carries names/roles so axe passes with zero serious/critical violations.
 *
 * All token-pure CSS lives in `resource-assignment.css` (no hardcoded colours).
 */

import { createEl, type Model, type RecordId } from '@jects/core';
import type { TaskModel } from '../contract.js';
import {
  resourceInitials,
  resourceColorToken,
  resourceName,
  clampUnits,
  type AssignmentStore,
  type ResourceModel,
  type TaskAssignmentInput,
} from './resource-assignment.js';

/** One editable assignment row in the field's draft value. */
export interface AssignmentDraftRow {
  resourceId: RecordId;
  /** Whether the resource is currently assigned (checkbox). */
  assigned: boolean;
  /** Allocation in percent for this resource. */
  units: number;
}

/** Construction options for {@link ResourceAssignmentField}. */
export interface ResourceAssignmentFieldOptions<T extends Model = Model> {
  /** The assignment store providing the resource catalogue (+ initial values). */
  store: AssignmentStore;
  /** The task being edited (its current assignments seed the draft). */
  taskId: RecordId;
  /**
   * The task record being edited (optional). When supplied it is surfaced to
   * `onChange` consumers; the draft is always seeded from `store`+`taskId` so
   * passing only `taskId` is sufficient.
   */
  task?: TaskModel<T>;
  /** Accessible label for the control group. Default `'Assigned resources'`. */
  label?: string;
  /** Default units for a freshly-checked resource. Default `100`. */
  defaultUnits?: number;
  /**
   * Show an over-allocation badge/styling on a resource row when assigning it (at
   * the draft units) would push the resource's total allocation past its
   * `maxUnits` capacity. Mirrors the Bryntum/DHTMLX red over-allocation cue.
   * Default `true`.
   */
  showOverAllocation?: boolean;
  /** Fired whenever the draft changes (toggle or units edit). */
  onChange?(value: TaskAssignmentInput[]): void;
}

/**
 * A keyboard-accessible multi-select of resources with per-assignment units %.
 * Lifecycle: `new ResourceAssignmentField(opts)` → append `field.el` into the
 * editor form → on save, `field.getValue()` (or `field.commitTo(store, taskId)`).
 */
export class ResourceAssignmentField<T extends Model = Model> {
  /** The owned control element (caller appends it into the editor form). */
  readonly el: HTMLElement;

  private readonly store: AssignmentStore;
  private readonly taskId: RecordId;
  /** The full task record being edited, when supplied (else undefined). */
  readonly task: TaskModel<T> | undefined;
  private readonly defaultUnits: number;
  private readonly showOverAllocation: boolean;
  private readonly onChange: ResourceAssignmentFieldOptions<T>['onChange'];
  private readonly draft = new Map<RecordId, AssignmentDraftRow>();
  private readonly disposers: Array<() => void> = [];
  /** Per-resource over-allocation badge elements, for live re-evaluation. */
  private readonly overBadges = new Map<RecordId, HTMLElement>();
  /** Per-resource row elements, for live over-allocation class toggling. */
  private readonly rowEls = new Map<RecordId, HTMLElement>();
  private destroyed = false;

  constructor(opts: ResourceAssignmentFieldOptions<T>) {
    this.store = opts.store;
    this.taskId = opts.taskId;
    this.task = opts.task;
    this.defaultUnits = opts.defaultUnits ?? 100;
    this.showOverAllocation = opts.showOverAllocation ?? true;
    this.onChange = opts.onChange;

    // Seed the draft from the store's current assignments.
    for (const r of this.store.getResources()) {
      const a = this.store.getAssignment(this.taskId, r.id);
      this.draft.set(r.id, {
        resourceId: r.id,
        assigned: a != null,
        units: a?.units ?? this.defaultUnits,
      });
    }

    this.el = createEl('div', { className: 'jects-gantt__assign-field' });
    const group = createEl('div', { className: 'jects-gantt__assign-list' });
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', opts.label ?? 'Assigned resources');
    this.el.append(group);
    this.renderRows(group);
    this.refreshOverAllocation();
  }

  /** The current draft as a clean assignment-input array (assigned rows only). */
  getValue(): TaskAssignmentInput[] {
    const out: TaskAssignmentInput[] = [];
    for (const row of this.draft.values()) {
      if (row.assigned) out.push({ resourceId: row.resourceId, units: clampUnits(row.units) });
    }
    return out;
  }

  /** Apply the draft to a store (the editor's "Save" path). */
  commitTo(store: AssignmentStore = this.store, taskId: RecordId = this.taskId): void {
    store.setAssignmentsForTask(taskId, this.getValue());
  }

  private renderRows(group: HTMLElement): void {
    const resources = this.store.getResources();
    if (resources.length === 0) {
      const empty = createEl('p', { className: 'jects-gantt__assign-empty' });
      empty.textContent = 'No resources available.';
      group.append(empty);
      return;
    }
    for (const r of resources) group.append(this.buildRow(r));
  }

  private buildRow(resource: ResourceModel): HTMLElement {
    const row = this.draft.get(resource.id)!;
    const rowEl = createEl('div', { className: 'jects-gantt__assign-row' });
    rowEl.dataset.resourceId = String(resource.id);

    const checkboxId = `jects-assign-${String(this.taskId)}-${String(resource.id)}`;

    // ── assign checkbox + avatar + name (a single label) ──────────────────
    const label = createEl('label', { className: 'jects-gantt__assign-label' });
    label.htmlFor = checkboxId;

    const checkbox = createEl('input', { className: 'jects-gantt__assign-check' }) as HTMLInputElement;
    checkbox.type = 'checkbox';
    checkbox.id = checkboxId;
    checkbox.checked = row.assigned;

    const avatar = createEl('span', { className: 'jects-gantt__avatar' });
    avatar.style.setProperty('--jects-avatar-color', `oklch(var(--jects-${resourceColorToken(resource)}))`);
    avatar.setAttribute('aria-hidden', 'true');
    if (resource.image) {
      const img = createEl('img', { className: 'jects-gantt__avatar-img' }) as HTMLImageElement;
      img.src = resource.image;
      img.alt = '';
      avatar.append(img);
    } else {
      avatar.textContent = resourceInitials(resource);
    }

    const nameEl = createEl('span', { className: 'jects-gantt__assign-name' });
    const displayName = resourceName(resource);
    nameEl.textContent = resource.role ? `${displayName} · ${resource.role}` : displayName;

    // ── over-allocation badge (shown when the projected total > capacity) ───
    const overBadge = createEl('span', { className: 'jects-gantt__assign-over' });
    overBadge.textContent = 'Over-allocated';
    overBadge.hidden = true;
    if (this.showOverAllocation) {
      this.overBadges.set(resource.id, overBadge);
    }

    label.append(checkbox, avatar, nameEl);
    if (this.showOverAllocation) label.append(overBadge);

    // ── units spinbutton (enabled only when assigned) ─────────────────────
    const unitsWrap = createEl('span', { className: 'jects-gantt__assign-units' });
    const unitsInput = createEl('input', { className: 'jects-gantt__assign-units-input' }) as HTMLInputElement;
    unitsInput.type = 'number';
    unitsInput.min = '0';
    unitsInput.max = '1000';
    unitsInput.step = '5';
    unitsInput.value = String(row.units);
    unitsInput.disabled = !row.assigned;
    const unitsLabel = `Allocation for ${displayName}, percent`;
    unitsInput.setAttribute('aria-label', unitsLabel);
    const pct = createEl('span', { className: 'jects-gantt__assign-units-pct' });
    pct.textContent = '%';
    pct.setAttribute('aria-hidden', 'true');
    unitsWrap.append(unitsInput, pct);

    // ── wiring ────────────────────────────────────────────────────────────
    const onToggle = (): void => {
      row.assigned = checkbox.checked;
      unitsInput.disabled = !row.assigned;
      rowEl.classList.toggle('jects-gantt__assign-row--on', row.assigned);
      this.refreshOverAllocation();
      this.emitChange();
    };
    const onUnits = (): void => {
      row.units = clampUnits(Number(unitsInput.value));
      this.refreshOverAllocation();
      this.emitChange();
    };
    checkbox.addEventListener('change', onToggle);
    unitsInput.addEventListener('input', onUnits);
    unitsInput.addEventListener('change', onUnits);
    this.disposers.push(() => {
      checkbox.removeEventListener('change', onToggle);
      unitsInput.removeEventListener('input', onUnits);
      unitsInput.removeEventListener('change', onUnits);
    });

    rowEl.classList.toggle('jects-gantt__assign-row--on', row.assigned);
    if (this.showOverAllocation) this.rowEls.set(resource.id, rowEl);
    rowEl.append(label, unitsWrap);
    return rowEl;
  }

  /**
   * Projected total allocation for a resource if the current draft were saved:
   * the committed units it already carries on *other* tasks, plus the draft
   * units for *this* task (when assigned). Used for the over-allocation cue
   * without mutating the store.
   */
  private projectedTotal(resourceId: RecordId): number {
    const committedHere = this.store.getAssignment(this.taskId, resourceId)?.units ?? 0;
    const otherTasks = this.store.totalUnitsForResource(resourceId) - committedHere;
    const row = this.draft.get(resourceId);
    const here = row?.assigned ? clampUnits(row.units) : 0;
    return otherTasks + here;
  }

  /** Whether the draft would over-allocate a resource past its capacity. */
  isOverAllocated(resourceId: RecordId): boolean {
    const cap = this.store.getResource(resourceId)?.maxUnits ?? 100;
    return this.projectedTotal(resourceId) > cap;
  }

  /** Re-evaluate + reflect over-allocation styling for every row. */
  private refreshOverAllocation(): void {
    if (!this.showOverAllocation) return;
    for (const [resourceId, rowEl] of this.rowEls) {
      const over = this.isOverAllocated(resourceId);
      rowEl.classList.toggle('jects-gantt__assign-row--over', over);
      const badge = this.overBadges.get(resourceId);
      if (badge) {
        badge.hidden = !over;
        const cap = this.store.getResource(resourceId)?.maxUnits ?? 100;
        badge.title = `Allocated ${this.projectedTotal(resourceId)}% of ${cap}% capacity`;
      }
    }
  }

  private emitChange(): void {
    if (this.destroyed) return;
    this.onChange?.(this.getValue());
  }

  /** Release listeners and remove the control element. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const d of this.disposers.splice(0)) d();
    this.el.remove();
  }
}
