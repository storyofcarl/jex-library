/**
 * `GanttTaskEditor` — the task editor dialog, reusing the `@jects/widgets`
 * `Window` (modal shell) + `Form` (typed field schema) controls. It edits a
 * single `TaskModel` and reports the patch back through `onSave`; the owning
 * `Gantt` widget routes the patch THROUGH the scheduling engine.
 *
 * The widgets dependency is imported lazily (dynamic `import()`) so the rest of
 * the Gantt UI — and its jsdom unit tests for the timeline/bridge logic — never
 * hard-couple to the widgets build, which evolves in a concurrent workflow. When
 * the editor is actually opened, the controls load on demand.
 */

import { createEl, type Model, type RecordId } from '@jects/core';
import type { TaskModel } from '../contract.js';
import type { AssignmentStore } from './resource-assignment.js';
import { ResourceAssignmentField } from './resource-assignment-field.js';

/** The subset of task fields the editor exposes. */
export interface TaskEditPatch {
  name?: string;
  start?: number;
  end?: number;
  duration?: number;
  percentDone?: number;
  milestone?: boolean;
  /** Total work in working-ms (effort-driven scheduling). */
  effort?: number;
  /** Whether the task's duration is derived from `effort / Σ units`. */
  effortDriven?: boolean;
}

export interface TaskEditorOptions {
  /** Where the modal mounts (defaults to document.body). */
  host?: HTMLElement;
  /** Called with the patch when the user saves. */
  onSave(taskId: RecordId, patch: TaskEditPatch): void;
  /** Called when the editor closes (saved or cancelled). */
  onClose?(): void;
  /**
   * Optional {@link AssignmentStore}. When provided, the editor renders an
   * "Assigned resources" section (a {@link ResourceAssignmentField}: add/remove
   * resources, set units %, over-allocation styling) below the task fields, and
   * commits its draft to the store on Save. Omit it and the editor is unchanged.
   */
  assignmentStore?: AssignmentStore;
  /**
   * Show the effort-driven fields (Effort in person-days + an Effort-driven
   * toggle). Enabled by the owning Gantt only when an effort-aware engine is
   * wired. Default `false` (a plain Gantt's editor is unchanged).
   */
  effortEnabled?: boolean;
  /** Working hours/day for the person-day ⇄ working-ms conversion. Default 8. */
  hoursPerDay?: number;
}

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;
const DEFAULT_HOURS_PER_DAY = 8;

export class GanttTaskEditor<T extends Model = Model> {
  private readonly opts: TaskEditorOptions;
  private win: { destroy(): void; el: HTMLElement } | null = null;
  private form: { getValue(): Record<string, unknown>; destroy(): void } | null = null;
  private assignField: ResourceAssignmentField | null = null;
  private destroyed = false;

  constructor(opts: TaskEditorOptions) {
    this.opts = opts;
  }

  get isOpen(): boolean {
    return this.win != null;
  }

  /** Open the editor for `task`. Resolves once the modal is mounted. */
  async open(task: TaskModel<T>): Promise<void> {
    if (this.destroyed) return;
    this.close();
    const host = this.opts.host ?? document.body;

    const { Window, Form, Button } = await import('@jects/widgets');
    if (this.destroyed) return;

    const win = new Window(host, {
      title: `Edit task — ${task.name ?? String(task.id)}`,
      modal: true,
      width: 420,
      closable: true,
      label: 'Task editor',
    });
    this.win = win as unknown as { destroy(): void; el: HTMLElement };
    win.on('close', () => this.handleClosed());

    const body = win.el.querySelector('.jects-window__body') as HTMLElement | null;
    const mount = body ?? win.el;
    mount.classList.add('jects-gantt__editor-body');

    const formHost = createEl('div', { className: 'jects-gantt__editor-form' });
    mount.append(formHost);

    // The Form `date` control is backed by a DatePicker that expects a
    // `Date | null` value (NOT a formatted string) — passing a string makes the
    // picker call `Date` methods on a string and throw. Hand it a real Date.
    const toDateInput = (ms?: number): Date | null =>
      ms != null ? new Date(ms) : null;

    const hoursPerDay =
      this.opts.hoursPerDay && this.opts.hoursPerDay > 0
        ? this.opts.hoursPerDay
        : DEFAULT_HOURS_PER_DAY;
    const effortToDays = (effort?: number): number =>
      effort != null ? Math.round((effort / MS_PER_HOUR / hoursPerDay) * 100) / 100 : 0;

    const effortDriven = (task as TaskModel<T> & { effortDriven?: boolean }).effortDriven === true;

    type EditorField = {
      name: string;
      control: string;
      label: string;
      value: unknown;
      props?: Record<string, unknown>;
    };
    const fields: EditorField[] = [
      { name: 'name', control: 'text', label: 'Name', value: task.name ?? '' },
      { name: 'start', control: 'date', label: 'Start', value: toDateInput(task.start) },
      { name: 'end', control: 'date', label: 'Finish', value: toDateInput(task.end) },
      {
        name: 'duration',
        control: 'number',
        label: 'Duration (days)',
        value: task.duration != null ? Math.round(task.duration / MS_PER_DAY) : 0,
      },
      {
        name: 'percentDone',
        control: 'number',
        label: 'Percent done (%)',
        value: task.percentDone != null ? Math.round(task.percentDone * 100) : 0,
        props: { min: 0, max: 100 },
      },
      { name: 'milestone', control: 'switch', label: 'Milestone', value: !!task.milestone },
    ];
    // Effort-driven fields, surfaced only when an effort-aware engine is wired.
    if (this.opts.effortEnabled) {
      fields.push(
        {
          name: 'effort',
          control: 'number',
          label: 'Effort (days)',
          value: effortToDays(task.effort),
          props: { min: 0, step: 0.25 },
        },
        {
          name: 'effortDriven',
          control: 'switch',
          label: 'Effort-driven',
          value: effortDriven,
        },
      );
    }

    // `fields` is a structural superset of the Form's FieldSchema (its `control`
    // is a string-literal union); cast the config at the lazy-import seam.
    const formConfig = {
      ariaLabel: 'Task fields',
      submitText: null,
      fields,
    } as unknown as ConstructorParameters<typeof Form>[1];
    const form = new Form(formHost, formConfig);
    this.form = form as unknown as { getValue(): Record<string, unknown>; destroy(): void };

    // ── Assigned-resources section (opt-in via `assignmentStore`) ───────────
    // A keyboard-operable multi-select (assign/unassign, set units %, with
    // over-allocation styling) seeded from + committed to the AssignmentStore.
    if (this.opts.assignmentStore) {
      const section = createEl('div', { className: 'jects-gantt__editor-section' });
      const heading = createEl('h3', { className: 'jects-gantt__editor-section-title' });
      heading.textContent = 'Assigned resources';
      const headingId = `jects-gantt-assign-${String(task.id)}`;
      heading.id = headingId;
      section.append(heading);

      this.assignField = new ResourceAssignmentField({
        store: this.opts.assignmentStore,
        taskId: task.id,
        label: 'Assigned resources',
      });
      // The section heading names the field group.
      this.assignField.el
        .querySelector('.jects-gantt__assign-list')
        ?.setAttribute('aria-labelledby', headingId);
      section.append(this.assignField.el);
      mount.append(section);
    }

    const actions = createEl('div', { className: 'jects-gantt__editor-actions' });
    const cancelBtn = new Button(actions, { text: 'Cancel', variant: 'ghost' });
    const saveBtn = new Button(actions, { text: 'Save', variant: 'primary' });
    cancelBtn.on('click', () => this.close());
    saveBtn.on('click', () => this.commit(task.id));
    mount.append(actions);
  }

  private commit(taskId: RecordId): void {
    if (!this.form) return;
    const values = this.form.getValue();
    const patch: TaskEditPatch = {};
    if (typeof values.name === 'string') patch.name = values.name;

    const parseDate = (v: unknown): number | undefined => {
      if (v == null || v === '') return undefined;
      // The date control yields a `Date`; tolerate a string/number too.
      const t = v instanceof Date ? v.getTime() : new Date(String(v)).getTime();
      return Number.isNaN(t) ? undefined : t;
    };
    const start = parseDate(values.start);
    const end = parseDate(values.end);
    if (start != null) patch.start = start;
    if (end != null) patch.end = end;

    const durDays = Number(values.duration);
    if (!Number.isNaN(durDays) && durDays >= 0) patch.duration = durDays * MS_PER_DAY;

    const pct = Number(values.percentDone);
    if (!Number.isNaN(pct)) patch.percentDone = Math.max(0, Math.min(1, pct / 100));

    patch.milestone = !!values.milestone;

    // Effort-driven fields (only present when the editor was opened with
    // `effortEnabled`). Effort is entered in person-days and converted back to
    // working-ms; the toggle flips effort-driven mode.
    if (this.opts.effortEnabled) {
      const hpd =
        this.opts.hoursPerDay && this.opts.hoursPerDay > 0
          ? this.opts.hoursPerDay
          : DEFAULT_HOURS_PER_DAY;
      const effDays = Number(values.effort);
      if (!Number.isNaN(effDays) && effDays >= 0) {
        patch.effort = Math.max(0, Math.round(effDays * hpd * MS_PER_HOUR));
      }
      patch.effortDriven = !!values.effortDriven;
    }

    // Commit the resource-assignment draft to the store (assign/unassign +
    // units %) BEFORE notifying the consumer, so a save is atomic.
    if (this.assignField && this.opts.assignmentStore) {
      this.assignField.commitTo(this.opts.assignmentStore, taskId);
    }

    this.opts.onSave(taskId, patch);
    this.close();
  }

  /** Close the editor without saving. */
  close(): void {
    if (this.win) {
      const w = this.win;
      this.win = null;
      this.assignField?.destroy();
      this.assignField = null;
      this.form?.destroy();
      this.form = null;
      w.destroy();
    }
  }

  private handleClosed(): void {
    this.assignField?.destroy();
    this.assignField = null;
    this.form?.destroy();
    this.form = null;
    this.win = null;
    this.opts.onClose?.();
  }

  destroy(): void {
    this.destroyed = true;
    this.close();
  }
}
