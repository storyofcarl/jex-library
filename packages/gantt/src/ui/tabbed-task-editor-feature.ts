/**
 * `GanttTabbedTaskEditorFeature` — the additive `GanttFeature` that makes the
 * orphaned multi-tab task editor ({@link GanttTabbedTaskEditor}) and the
 * effort panel ({@link EffortPanel}) **reachable** from a live `Gantt`, bringing
 * the editor to Bryntum/DHTMLX parity: a tabbed dialog with a **General** tab
 * (name / start / finish / duration / %done / milestone) and a **Resources** tab
 * where you assign/unassign resources and set each assignment's allocation
 * (units %).
 *
 * Why a feature (concurrency-safe, contract-pure):
 *   - The two UI controls were fully built + tested (`task-editor-tabs.ts`,
 *     `effort-panel.ts`) but never exported from a barrel and never wired into the
 *     `Gantt`, so they were unreachable. This module is the missing seam: it is a
 *     NEW file that re-exports them (so a barrel can pick them up — see the wire
 *     notes) AND installs them onto a live `Gantt` without editing the `Gantt`
 *     class, the timeline view, the package barrel, or any shared config.
 *   - It is a standard `GanttFeature`: install via
 *     `gantt.use(new GanttTabbedTaskEditorFeature())` or
 *     `new Gantt(el, { plugins: [new GanttTabbedTaskEditorFeature()] })`. It
 *     touches ONLY the public `GanttApi` (`el`, `getTask`, `updateTask`, `track`)
 *     plus an optional {@link AssignmentStore}.
 *
 * How the swap works (no edit to the `Gantt` class required):
 *   - The built-in single-form editor opens on a task **double-click** (the
 *     timeline `barsLayer` and the tree both wire `onTaskDblClick → openEditor`).
 *     This feature installs ONE **capture-phase** `dblclick` listener on the
 *     Gantt root (`api.el`). Capture runs outer→inner, so it fires *before* the
 *     descendant `barsLayer`/tree listeners; it calls `stopImmediatePropagation()`
 *     to suppress the built-in editor, then opens the tabbed editor instead. This
 *     is fully reversible (the listener is removed on `destroy()`), so the swap is
 *     opt-in per Gantt instance and leaves the class untouched.
 *   - Integrators who prefer an explicit swap can set `interceptDoubleClick:false`
 *     and call `feature.editTask(taskId)` from their own `openEditor` override
 *     (see `RES.wireNotes`).
 *
 * On Save the tabbed editor reports a typed {@link TaskEditorSavePayload}; this
 * feature routes the General-tab patch THROUGH `api.updateTask` (so the engine
 * re-propagates exactly like a live edit) and commits the Resources-tab draft to
 * the {@link AssignmentStore}.
 */

import type { Model, RecordId } from '@jects/core';
import type { GanttApi, GanttFeature, TaskModel } from '../contract.js';
import {
  GanttTabbedTaskEditor,
  type TaskEditorSavePayload,
} from './task-editor-tabs.js';
import { AssignmentStore } from './resource-assignment.js';
import type {
  ResourceModel,
  AssignmentModel,
} from './resource-assignment.js';

/** The feature's registry name on `GanttApi.features`. */
export const TABBED_TASK_EDITOR_FEATURE = 'tabbedTaskEditor';

/** Configuration for {@link GanttTabbedTaskEditorFeature}. */
export interface GanttTabbedTaskEditorConfig {
  /**
   * The assignment store backing the **Resources** tab. When omitted, the
   * feature creates an empty {@link AssignmentStore} (so the tab is present but
   * unpopulated) UNLESS `resources`/`assignments` are supplied, in which case it
   * seeds a store from them. Supply your own store to share it with the
   * task-tree "Resources" column / bar labels.
   */
  assignmentStore?: AssignmentStore;
  /** Seed resources for an auto-created store (ignored when `assignmentStore` is given). */
  resources?: ResourceModel[];
  /** Seed assignments for an auto-created store (ignored when `assignmentStore` is given). */
  assignments?: AssignmentModel[];
  /**
   * Hide the Resources tab entirely (degrade to a General-only tabbed editor).
   * Default `false` (the Resources tab is the whole point of the swap).
   */
  hideResourcesTab?: boolean;
  /** Default units for a freshly-checked resource in the Resources tab. Default `100`. */
  defaultUnits?: number;
  /**
   * Install the capture-phase double-click interceptor that swaps the built-in
   * editor for the tabbed one. Default `true`. Set `false` to drive the editor
   * yourself via {@link GanttTabbedTaskEditorFeature.editTask}.
   */
  interceptDoubleClick?: boolean;
  /**
   * Where the editor dialog mounts. Default `document.body` (a true modal overlay
   * whose background can be inerted). Pass the Gantt `el` to nest it instead.
   */
  host?: HTMLElement;
  /** Called after a Save commits, with the task id + the full editor payload. */
  onSave?(taskId: RecordId, payload: TaskEditorSavePayload): void;
}

/**
 * Installs the multi-tab task editor onto a live Gantt. See the module doc for
 * the (reversible, non-destructive) double-click swap mechanism.
 */
export class GanttTabbedTaskEditorFeature<T extends Model = Model>
  implements GanttFeature<T>
{
  readonly name = TABBED_TASK_EDITOR_FEATURE;

  private readonly config: GanttTabbedTaskEditorConfig;
  private api: GanttApi<T> | null = null;
  private editor: GanttTabbedTaskEditor<T> | null = null;
  private store: AssignmentStore | null = null;
  private readonly disposers: Array<() => void> = [];

  constructor(config: GanttTabbedTaskEditorConfig = {}) {
    this.config = config;
  }

  /** The assignment store backing the Resources tab (created if none was given). */
  get assignmentStore(): AssignmentStore | null {
    return this.store;
  }

  /** Whether the editor dialog is currently open. */
  get isOpen(): boolean {
    return this.editor?.isOpen ?? false;
  }

  init(api: GanttApi<T>): void {
    this.api = api;

    const store = this.resolveStore();
    this.store = store;

    const hasResources = !this.config.hideResourcesTab;
    this.editor = new GanttTabbedTaskEditor<T>({
      ...(this.config.host ? { host: this.config.host } : {}),
      ...(hasResources ? { assignmentStore: store } : {}),
      ...(this.config.defaultUnits != null
        ? { defaultUnits: this.config.defaultUnits }
        : {}),
      // We route the General-tab patch through the engine ourselves; the editor
      // still commits the Resources draft to the store (commitAssignments).
      onSave: (taskId, payload) => this.onEditorSave(taskId, payload),
    });

    if (this.config.interceptDoubleClick ?? true) {
      this.installDoubleClickSwap(api);
    }

    // Leak-safe teardown registered with the Gantt as well as locally.
    api.track(() => this.destroy());
  }

  /**
   * Resolve the assignment store: the supplied one, else a fresh store seeded
   * from `resources`/`assignments`.
   */
  private resolveStore(): AssignmentStore {
    if (this.config.assignmentStore) {
      return this.config.assignmentStore;
    }
    return new AssignmentStore({
      ...(this.config.resources ? { resources: this.config.resources } : {}),
      ...(this.config.assignments ? { assignments: this.config.assignments } : {}),
    });
  }

  /**
   * Install a capture-phase `dblclick` listener on the Gantt root that swaps the
   * built-in editor for the tabbed editor. Capture fires before the descendant
   * bar/tree listeners, so `stopImmediatePropagation()` suppresses the original.
   */
  private installDoubleClickSwap(api: GanttApi<T>): void {
    const handler = (ev: Event): void => {
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      const taskId = this.taskIdFromEvent(target);
      if (taskId == null) return;
      // Suppress the built-in single-form editor (its listener sits on a
      // descendant, so a capture-phase stop here wins the race).
      ev.stopImmediatePropagation();
      ev.preventDefault();
      this.editTask(taskId);
    };
    api.el.addEventListener('dblclick', handler, true);
    this.disposers.push(() => api.el.removeEventListener('dblclick', handler, true));
  }

  /**
   * Resolve the task id from a double-clicked element: a timeline bar
   * (`.jects-gantt__bar[data-task-id]`) or a task-tree row
   * (`[data-task-id]` / `[data-id]`). Returns `undefined` when the click is not
   * on a task.
   */
  private taskIdFromEvent(target: HTMLElement): RecordId | undefined {
    const bar = target.closest('.jects-gantt__bar') as HTMLElement | null;
    const raw =
      bar?.dataset.taskId ??
      (target.closest('[data-task-id]') as HTMLElement | null)?.dataset.taskId ??
      (target.closest('[data-id]') as HTMLElement | null)?.dataset.id;
    if (raw == null) return undefined;
    return this.coerceTaskId(raw);
  }

  /**
   * Coerce a DOM string id back to the model's id type by checking the live
   * store, so numeric ids resolve to numbers and string ids stay strings.
   */
  private coerceTaskId(raw: string): RecordId | undefined {
    const api = this.api;
    if (!api) return undefined;
    if (api.getTask(raw)) return raw;
    const asNum = Number(raw);
    if (Number.isFinite(asNum) && api.getTask(asNum)) return asNum;
    return raw;
  }

  /**
   * Open the tabbed editor for `taskId`. Public so an integrator who set
   * `interceptDoubleClick:false` can wire it into their own `openEditor`.
   */
  editTask(taskId: RecordId): void {
    const api = this.api;
    const editor = this.editor;
    if (!api || !editor) return;
    const task = api.getTask(taskId);
    if (!task) return;
    editor.open(task);
  }

  /** Close the editor without saving (no-op when closed). */
  close(): void {
    this.editor?.close();
  }

  /**
   * Route a Save: apply the General-tab patch through the engine (so it
   * re-propagates) and forward to the consumer callback. The Resources draft is
   * already committed to the store by the editor (`commitAssignments`).
   */
  private onEditorSave(taskId: RecordId, payload: TaskEditorSavePayload): void {
    const api = this.api;
    if (api) {
      const p = payload.patch;
      const next: Partial<TaskModel<T>> = {};
      if (p.name != null) next.name = p.name;
      if (p.start != null) next.start = p.start;
      if (p.end != null) next.end = p.end;
      if (p.duration != null) next.duration = p.duration;
      if (p.percentDone != null) next.percentDone = p.percentDone;
      if (p.milestone != null) next.milestone = p.milestone;
      if (p.effort != null) next.effort = p.effort;
      if (p.effortDriven != null) {
        (next as TaskModel<T> & { effortDriven?: boolean }).effortDriven = p.effortDriven;
      }
      // Mirror the committed assignment resource ids onto the task so the engine
      // sees the staffing (the store stays the richer per-units source of truth).
      next.resourceIds = payload.assignments.map((a) => a.resourceId);
      if (Object.keys(next).length > 0) api.updateTask(taskId, next);
    }
    this.config.onSave?.(taskId, payload);
  }

  destroy(): void {
    for (const d of this.disposers.splice(0)) d();
    this.editor?.destroy();
    this.editor = null;
    // The store holds no DOM/timers (and a supplied one is not ours to dispose),
    // so there is nothing to release — drop the reference.
    this.store = null;
    this.api = null;
  }
}

/** Functional constructor form, mirroring the other Gantt feature factories. */
export function createTabbedTaskEditor<T extends Model = Model>(
  config?: GanttTabbedTaskEditorConfig,
): GanttTabbedTaskEditorFeature<T> {
  return new GanttTabbedTaskEditorFeature<T>(config);
}

/* ── Re-exports: make the orphaned controls reachable from this module ──────
   These two controls were implemented + tested but never barrel-exported. The
   feature above is the integration seam; these named re-exports let a package
   barrel surface the raw controls too (see RES.wireNotes for the barrel lines).
   Re-exported here (not by editing a shared barrel) to stay concurrency-safe. */
export {
  GanttTabbedTaskEditor,
  TASK_EDITOR_TABS,
  toDateValue,
  parseDateInput,
} from './task-editor-tabs.js';
export type {
  TaskEditorTab,
  TaskEditorSavePayload,
  TabbedTaskEditorOptions,
} from './task-editor-tabs.js';

export { EffortPanel } from './effort-panel.js';
export type { EffortPanelConfig, EffortPanelEvents } from './effort-panel.js';
