/**
 * `GanttTabbedTaskEditor` — the **multi-tab** task editor, bringing the Gantt
 * task editor to Bryntum/DHTMLX parity by adding a **Resources** tab next to the
 * existing **General** tab (name / start / end / duration / %done / milestone).
 *
 * Bryntum's TaskEditor is a tabbed dialog: a "General" tab with the core fields
 * and a "Resources" tab where you assign/unassign people and set each
 * assignment's allocation (units %). DHTMLX surfaces the same via its resource
 * assignment panel. The single-form `GanttTaskEditor` only ever exposed the
 * General fields; this module adds the missing assignment tab.
 *
 * Design (concurrency-safe, contract-pure — same discipline as the rest of the
 * resource-assignment feature):
 *   - This is a NEW, self-contained control. It does NOT edit the existing
 *     `GanttTaskEditor` class, the `Gantt` class, the package barrel, or any
 *     shared config — it only *adds* a module. The integrator wires it in by
 *     swapping the editor instance (see the module wire notes / `RES.wireNotes`).
 *   - It does NOT hard-depend on `@jects/widgets`: the General fields are native
 *     `<input>`s and the Resources tab mounts the existing
 *     {@link ResourceAssignmentField}. That keeps it usable in the jsdom editor
 *     body (and in the jsdom unit tests) without the widgets build, which evolves
 *     in a concurrent workflow. A `Window` shell can wrap it, but is optional.
 *   - The tablist is a proper WAI-ARIA tabs widget: `role="tablist"` with roving
 *     tabindex, Arrow/Home/End key navigation, `aria-selected`, and
 *     `aria-controls`/`aria-labelledby` wiring between each tab and its panel, so
 *     axe passes with zero serious/critical violations and the whole editor is
 *     keyboard operable.
 *   - Edits are a LOCAL draft. Nothing reaches the task model or the
 *     {@link AssignmentStore} until the user presses **Save**, so **Cancel** is
 *     honest. On Save it reports a typed {@link TaskEditPatch} through `onSave`
 *     AND (if a store is supplied) commits the assignment draft to the store.
 *
 * All token-pure CSS lives in `task-editor-tabs.css` (no hardcoded colours).
 */

import './task-editor-tabs.css';
import { createEl, trapFocus, type Model, type RecordId } from '@jects/core';
import type { TaskModel } from '../contract.js';
import type { TaskEditPatch } from './task-editor.js';
import { ResourceAssignmentField } from './resource-assignment-field.js';
import type { AssignmentStore, TaskAssignmentInput } from './resource-assignment.js';

const MS_PER_DAY = 86_400_000;

/** A single tab descriptor (id + visible label). */
export interface TaskEditorTab {
  /** Stable tab id (used to build the tab/panel element ids). */
  readonly id: string;
  /** Visible tab label. */
  readonly label: string;
}

/** The built-in tab ids. */
export const TASK_EDITOR_TABS = {
  general: 'general',
  resources: 'resources',
} as const;

/** The full save payload: the field patch + the resource-assignment draft. */
export interface TaskEditorSavePayload {
  /** The General-tab field patch (same shape as the single-form editor). */
  patch: TaskEditPatch;
  /** The Resources-tab draft (assigned resources + units %); `[]` when none. */
  assignments: TaskAssignmentInput[];
}

/** Construction options for {@link GanttTabbedTaskEditor}. */
export interface TabbedTaskEditorOptions {
  /** Where the editor mounts (defaults to `document.body`). */
  host?: HTMLElement;
  /**
   * The assignment store backing the Resources tab. When omitted, the Resources
   * tab is HIDDEN (the editor degrades to the General tab only), so the control
   * is safe to use in a project with no resource layer.
   */
  assignmentStore?: AssignmentStore;
  /**
   * Default units for a freshly-checked resource in the Resources tab.
   * Default `100` (full time).
   */
  defaultUnits?: number;
  /**
   * Whether saving should also commit the assignment draft to the
   * `assignmentStore` (via `setAssignmentsForTask`). Default `true`. Set `false`
   * to handle the commit yourself from the `onSave` payload.
   */
  commitAssignments?: boolean;
  /** Called with the task id + full payload when the user saves. */
  onSave(taskId: RecordId, payload: TaskEditorSavePayload): void;
  /** Called when the editor closes (saved or cancelled). */
  onClose?(): void;
}

/**
 * A keyboard-accessible, multi-tab task editor (General + Resources).
 *
 * Lifecycle: `new GanttTabbedTaskEditor(opts)` → `editor.open(task)` mounts the
 * dialog → user edits across tabs → **Save** fires `onSave(taskId, payload)` and
 * (optionally) commits assignments → `editor.close()` / `editor.destroy()`.
 */
export class GanttTabbedTaskEditor<T extends Model = Model> {
  private readonly opts: TabbedTaskEditorOptions;
  private readonly defaultUnits: number;
  private readonly commitAssignments: boolean;

  private rootEl: HTMLElement | null = null;
  private field: ResourceAssignmentField | null = null;
  private destroyed = false;

  /** Tab buttons + panels, in tab order. */
  private tabs: TaskEditorTab[] = [];
  private tabButtons: HTMLButtonElement[] = [];
  private panels: HTMLElement[] = [];
  private activeIndex = 0;

  /** Live references to the General-tab inputs (read on commit). */
  private fields: {
    name?: HTMLInputElement;
    start?: HTMLInputElement;
    end?: HTMLInputElement;
    duration?: HTMLInputElement;
    percentDone?: HTMLInputElement;
    milestone?: HTMLInputElement;
  } = {};

  private readonly disposers: Array<() => void> = [];

  /**
   * Sibling elements of the dialog that we marked `aria-hidden`/`inert` while
   * open, so the background behind the modal is removed from the a11y tree and
   * is non-interactive. Restored on close.
   */
  private inertedSiblings: HTMLElement[] = [];

  constructor(opts: TabbedTaskEditorOptions) {
    this.opts = opts;
    this.defaultUnits = opts.defaultUnits ?? 100;
    this.commitAssignments = opts.commitAssignments ?? true;
  }

  /** Whether the editor is currently mounted. */
  get isOpen(): boolean {
    return this.rootEl != null;
  }

  /** The currently active tab id, or `undefined` when closed. */
  get activeTabId(): string | undefined {
    return this.tabs[this.activeIndex]?.id;
  }

  /** The owned root element while open (for hosting in a Window etc.), else `null`. */
  get el(): HTMLElement | null {
    return this.rootEl;
  }

  /** Open the editor for `task`. */
  open(task: TaskModel<T>): void {
    if (this.destroyed) return;
    this.close();
    const host = this.opts.host ?? document.body;

    const hasResources = this.opts.assignmentStore != null;
    this.tabs = hasResources
      ? [
          { id: TASK_EDITOR_TABS.general, label: 'General' },
          { id: TASK_EDITOR_TABS.resources, label: 'Resources' },
        ]
      : [{ id: TASK_EDITOR_TABS.general, label: 'General' }];

    const root = createEl('div', { className: 'jects-gantt__task-editor' });
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    const titleId = `jects-gantt-te-title-${String(task.id)}`;
    root.setAttribute('aria-labelledby', titleId);

    const title = createEl('h2', { className: 'jects-gantt__task-editor-title' });
    title.id = titleId;
    title.textContent = `Edit task — ${task.name ?? String(task.id)}`;
    root.append(title);

    root.append(this.buildTablist(task));
    for (const panel of this.panels) root.append(panel);
    root.append(this.buildActions(task.id));

    host.append(root);
    this.rootEl = root;
    this.activateTab(0, false);

    // Escape closes the dialog (Cancel semantics).
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        this.close();
      }
    };
    root.addEventListener('keydown', onKey);
    this.disposers.push(() => root.removeEventListener('keydown', onKey));

    // Modal a11y: take the rest of the page out of the a11y tree + make it
    // non-interactive while the dialog overlays it, so AT/keyboard users can't
    // reach the background behind an `aria-modal="true"` dialog.
    this.markBackgroundInert(root);

    // Trap Tab/Shift+Tab inside the dialog so focus cannot escape to the page
    // behind it. The core trap cycles between the first/last focusable element.
    const releaseTrap = trapFocus(root);
    this.disposers.push(releaseTrap);

    // Focus the first tab for immediate keyboard operability (after the trap so
    // it doesn't get overridden by the trap's initial first-focusable focus).
    this.tabButtons[0]?.focus();
  }

  /**
   * Mark every sibling of the dialog `aria-hidden="true"` + `inert` so the
   * background is removed from the a11y tree and cannot receive focus or
   * pointer events while the modal is open. Skips nodes already hidden so we
   * don't clobber pre-existing state on restore.
   */
  private markBackgroundInert(root: HTMLElement): void {
    const parent = root.parentElement;
    if (!parent) return;
    for (const sib of Array.from(parent.children)) {
      if (sib === root || !(sib instanceof HTMLElement)) continue;
      if (sib.getAttribute('aria-hidden') === 'true' || sib.hasAttribute('inert')) {
        continue;
      }
      sib.setAttribute('aria-hidden', 'true');
      sib.setAttribute('inert', '');
      this.inertedSiblings.push(sib);
    }
  }

  /** Undo {@link markBackgroundInert}. */
  private releaseBackgroundInert(): void {
    for (const sib of this.inertedSiblings) {
      sib.removeAttribute('aria-hidden');
      sib.removeAttribute('inert');
    }
    this.inertedSiblings = [];
  }

  /* ── tablist ─────────────────────────────────────────────────────────────── */

  private buildTablist(task: TaskModel<T>): HTMLElement {
    const tablist = createEl('div', { className: 'jects-gantt__task-editor-tabs' });
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', 'Task editor sections');

    this.tabButtons = [];
    this.panels = [];

    this.tabs.forEach((tab, i) => {
      const tabId = `jects-gantt-te-tab-${tab.id}`;
      const panelId = `jects-gantt-te-panel-${tab.id}`;

      const btn = createEl('button', {
        className: 'jects-gantt__task-editor-tab',
      }) as HTMLButtonElement;
      btn.type = 'button';
      btn.id = tabId;
      btn.textContent = tab.label;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-controls', panelId);
      btn.setAttribute('aria-selected', 'false');
      btn.tabIndex = -1;
      btn.dataset.tabIndex = String(i);

      const onClick = (): void => this.activateTab(i, true);
      const onKeyNav = (ev: KeyboardEvent): void => this.onTabKey(ev, i);
      btn.addEventListener('click', onClick);
      btn.addEventListener('keydown', onKeyNav);
      this.disposers.push(() => {
        btn.removeEventListener('click', onClick);
        btn.removeEventListener('keydown', onKeyNav);
      });

      tablist.append(btn);
      this.tabButtons.push(btn);

      const panel = createEl('div', { className: 'jects-gantt__task-editor-panel' });
      panel.id = panelId;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tabId);
      panel.tabIndex = 0;
      panel.hidden = true;
      this.fillPanel(tab.id, panel, task);
      this.panels.push(panel);
    });

    return tablist;
  }

  private onTabKey(ev: KeyboardEvent, index: number): void {
    const last = this.tabButtons.length - 1;
    let next = index;
    switch (ev.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = index === last ? 0 : index + 1;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = index === 0 ? last : index - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      default:
        return;
    }
    ev.preventDefault();
    this.activateTab(next, true);
  }

  private activateTab(index: number, focus: boolean): void {
    if (index < 0 || index >= this.tabButtons.length) return;
    this.activeIndex = index;
    this.tabButtons.forEach((btn, i) => {
      const selected = i === index;
      btn.setAttribute('aria-selected', selected ? 'true' : 'false');
      btn.tabIndex = selected ? 0 : -1;
      btn.classList.toggle('jects-gantt__task-editor-tab--active', selected);
      const panel = this.panels[i];
      if (panel) panel.hidden = !selected;
    });
    if (focus) this.tabButtons[index]?.focus();
  }

  /* ── panel content ───────────────────────────────────────────────────────── */

  private fillPanel(tabId: string, panel: HTMLElement, task: TaskModel<T>): void {
    if (tabId === TASK_EDITOR_TABS.resources) {
      this.fillResourcesPanel(panel, task);
    } else {
      this.fillGeneralPanel(panel, task);
    }
  }

  private fillGeneralPanel(panel: HTMLElement, task: TaskModel<T>): void {
    const form = createEl('div', { className: 'jects-gantt__task-editor-form' });

    this.fields.name = this.addTextRow(form, 'name', 'Name', 'text', task.name ?? '');
    this.fields.start = this.addTextRow(
      form,
      'start',
      'Start',
      'date',
      toDateValue(task.start),
    );
    this.fields.end = this.addTextRow(
      form,
      'end',
      'Finish',
      'date',
      toDateValue(task.end),
    );
    this.fields.duration = this.addTextRow(
      form,
      'duration',
      'Duration (days)',
      'number',
      task.duration != null ? String(Math.round(task.duration / MS_PER_DAY)) : '0',
      { min: '0', step: '1' },
    );
    this.fields.percentDone = this.addTextRow(
      form,
      'percentDone',
      'Percent done (%)',
      'number',
      task.percentDone != null ? String(Math.round(task.percentDone * 100)) : '0',
      { min: '0', max: '100', step: '1' },
    );
    this.fields.milestone = this.addCheckRow(
      form,
      'milestone',
      'Milestone',
      !!task.milestone,
    );

    panel.append(form);
  }

  private fillResourcesPanel(panel: HTMLElement, task: TaskModel<T>): void {
    const store = this.opts.assignmentStore;
    if (!store) return;
    const field = new ResourceAssignmentField({
      store,
      taskId: task.id,
      label: 'Assigned resources',
      defaultUnits: this.defaultUnits,
    });
    this.field = field;
    panel.append(field.el);
  }

  private addTextRow(
    form: HTMLElement,
    name: string,
    labelText: string,
    type: string,
    value: string,
    attrs?: Record<string, string>,
  ): HTMLInputElement {
    const id = `jects-gantt-te-field-${name}`;
    const row = createEl('div', { className: 'jects-gantt__task-editor-row' });
    const label = createEl('label', { className: 'jects-gantt__task-editor-label' });
    label.htmlFor = id;
    label.textContent = labelText;
    const input = createEl('input', {
      className: 'jects-gantt__task-editor-input',
    }) as HTMLInputElement;
    input.id = id;
    input.type = type;
    input.value = value;
    if (attrs) for (const [k, v] of Object.entries(attrs)) input.setAttribute(k, v);
    row.append(label, input);
    form.append(row);
    return input;
  }

  private addCheckRow(
    form: HTMLElement,
    name: string,
    labelText: string,
    checked: boolean,
  ): HTMLInputElement {
    const id = `jects-gantt-te-field-${name}`;
    const row = createEl('div', {
      className: 'jects-gantt__task-editor-row jects-gantt__task-editor-row--check',
    });
    const input = createEl('input', {
      className: 'jects-gantt__task-editor-check',
    }) as HTMLInputElement;
    input.id = id;
    input.type = 'checkbox';
    input.checked = checked;
    const label = createEl('label', { className: 'jects-gantt__task-editor-label' });
    label.htmlFor = id;
    label.textContent = labelText;
    row.append(input, label);
    form.append(row);
    return input;
  }

  /* ── actions ─────────────────────────────────────────────────────────────── */

  private buildActions(taskId: RecordId): HTMLElement {
    const actions = createEl('div', { className: 'jects-gantt__task-editor-actions' });

    const cancelBtn = createEl('button', {
      className: 'jects-gantt__task-editor-btn jects-gantt__task-editor-btn--ghost',
    }) as HTMLButtonElement;
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';

    const saveBtn = createEl('button', {
      className: 'jects-gantt__task-editor-btn jects-gantt__task-editor-btn--primary',
    }) as HTMLButtonElement;
    saveBtn.type = 'button';
    saveBtn.textContent = 'Save';

    const onCancel = (): void => this.close();
    const onSave = (): void => this.commit(taskId);
    cancelBtn.addEventListener('click', onCancel);
    saveBtn.addEventListener('click', onSave);
    this.disposers.push(() => {
      cancelBtn.removeEventListener('click', onCancel);
      saveBtn.removeEventListener('click', onSave);
    });

    actions.append(cancelBtn, saveBtn);
    return actions;
  }

  /* ── commit ──────────────────────────────────────────────────────────────── */

  /** Read the live draft into a typed save payload (without closing). */
  getPayload(): TaskEditorSavePayload {
    const f = this.fields;
    const patch: TaskEditPatch = {};

    if (f.name) patch.name = f.name.value;

    const start = parseDateInput(f.start?.value);
    if (start != null) patch.start = start;
    const end = parseDateInput(f.end?.value);
    if (end != null) patch.end = end;

    if (f.duration) {
      const days = Number(f.duration.value);
      if (Number.isFinite(days) && days >= 0) patch.duration = days * MS_PER_DAY;
    }
    if (f.percentDone) {
      const pct = Number(f.percentDone.value);
      if (Number.isFinite(pct)) patch.percentDone = Math.max(0, Math.min(1, pct / 100));
    }
    if (f.milestone) patch.milestone = f.milestone.checked;

    const assignments = this.field ? this.field.getValue() : [];
    return { patch, assignments };
  }

  private commit(taskId: RecordId): void {
    if (this.destroyed || !this.rootEl) return;
    const payload = this.getPayload();
    if (this.commitAssignments && this.opts.assignmentStore && this.field) {
      this.opts.assignmentStore.setAssignmentsForTask(taskId, payload.assignments);
    }
    this.opts.onSave(taskId, payload);
    this.close();
  }

  /** Close the editor without saving. */
  close(): void {
    if (!this.rootEl) return;
    for (const d of this.disposers.splice(0)) d();
    this.releaseBackgroundInert();
    this.field?.destroy();
    this.field = null;
    this.fields = {};
    this.tabButtons = [];
    this.panels = [];
    this.tabs = [];
    this.activeIndex = 0;
    const root = this.rootEl;
    this.rootEl = null;
    root.remove();
    this.opts.onClose?.();
  }

  /** Release everything; the editor cannot be reopened. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.close();
  }
}

/* ── pure helpers (exported for unit testing) ─────────────────────────────── */

/** A `Date`/epoch-ms → `yyyy-mm-dd` value for a native `<input type="date">`. */
export function toDateValue(ms?: number): string {
  if (ms == null || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse a native date input value back to epoch ms (UTC), or `undefined`. */
export function parseDateInput(value?: string): number | undefined {
  if (value == null || value === '') return undefined;
  const t = Date.parse(value);
  return Number.isNaN(t) ? undefined : t;
}
