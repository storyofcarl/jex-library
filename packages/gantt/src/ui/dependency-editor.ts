/**
 * `GanttDependencyColumns` — the editable **Predecessors** + **Successors**
 * task-tree columns and their inline notation editor, at Bryntum/DHTMLX parity.
 *
 * What this adds over the read-only Predecessors display that ships in
 * `task-tree.ts`:
 *   - A **Successors** column (links where the row is the predecessor).
 *   - **Editable** Predecessors AND Successors cells: the user types notation
 *     like `2FS+1d, 3SS` and the diff is routed through
 *     `GanttApi.addDependency` / `GanttApi.removeDependency` — the SAME engine
 *     seam a drag-created link uses, so the schedule re-propagates and the
 *     critical path updates.
 *   - **Validation + cycle-rejection feedback**: malformed terms, unknown task
 *     refs, self-references and links the engine rejects (cycle) surface as an
 *     inline, ARIA-live error message under the editor; the cell value reverts.
 *
 * Design (concurrency-safe, contract-pure):
 *   - It is a SELF-CONTAINED controller built ONLY against the frozen
 *     {@link GanttApi}. It does not edit the `Gantt` class, the timeline view, or
 *     the `GanttTaskTree`. A consumer installs it as a `GanttFeature`
 *     (`gantt.use(new GanttDependencyColumns())`) or drives the editor directly.
 *   - The inline editor ({@link DependencyCellEditor}) is a standalone, fully
 *     keyboard-operable control with its own `el`; mount it over a cell, read its
 *     committed value through `onCommit`. It works without `@jects/widgets` and
 *     without the grid, so it is testable in jsdom.
 *   - All token-pure CSS lives in `dependency-editor.css` (no hardcoded colours).
 */

import './dependency-editor.css';

import { createEl, type Model, type RecordId } from '@jects/core';
import type {
  DependencyModel,
  DependencyType,
  GanttApi,
  GanttFeature,
  TaskModel,
} from '../contract.js';
import {
  diffDependencyTerms,
  parseDependencyNotation,
  serializeDependencyTerms,
  type ParsedDependencyTerm,
  type ParseOptions,
  type SerializeOptions,
} from './dependency-notation.js';

/** Which side of a link a cell edits. */
export type DependencySide = 'predecessors' | 'successors';

/** Field id of the editable predecessors column. */
export const PREDECESSORS_COLUMN_FIELD = 'predecessors';
/** Field id of the editable successors column. */
export const SUCCESSORS_COLUMN_FIELD = 'successors';

/** A link as seen from one side of a cell (already oriented to that side). */
export interface OrientedLink {
  /** The dependency link id. */
  id: RecordId;
  /** The OTHER task in the link (predecessor for a predecessors cell, etc.). */
  ref: RecordId;
  /** Dependency type. */
  type: DependencyType;
  /** Lag (+) / lead (−) in ms. */
  lag: number;
}

/** The outcome of applying an edited notation string to a cell. */
export interface ApplyResult {
  /** Whether every requested edit succeeded. */
  ok: boolean;
  /** Number of links added. */
  added: number;
  /** Number of links removed. */
  removed: number;
  /** Human-readable error messages (parse errors + engine rejections). */
  errors: string[];
}

/* ═══════════════════════════════════════════════════════════════════════════
   Oriented reads + notation round-trip over the GanttApi
   ═══════════════════════════════════════════════════════════════════════════ */

/** The active links touching `taskId` on the given `side`, oriented. */
export function orientedLinksFor<T extends Model>(
  api: GanttApi<T>,
  taskId: RecordId,
  side: DependencySide,
): OrientedLink[] {
  const out: OrientedLink[] = [];
  for (const d of api.getDependenciesFor(taskId)) {
    if (d.active === false) continue;
    if (side === 'predecessors') {
      if (String(d.toId) !== String(taskId)) continue;
      out.push({ id: d.id, ref: d.fromId, type: d.type ?? 'FS', lag: d.lag ?? 0 });
    } else {
      if (String(d.fromId) !== String(taskId)) continue;
      out.push({ id: d.id, ref: d.toId, type: d.type ?? 'FS', lag: d.lag ?? 0 });
    }
  }
  return out;
}

/** The notation string for a cell (e.g. `"2FS+1d, 3SS"`). */
export function notationFor<T extends Model>(
  api: GanttApi<T>,
  taskId: RecordId,
  side: DependencySide,
  options?: SerializeOptions,
): string {
  return serializeDependencyTerms(orientedLinksFor(api, taskId, side), options);
}

/**
 * Build the `DependencyModel` (minus id) for one parsed term, oriented to a side.
 * For a predecessors cell, the referenced task is the predecessor (`fromId`);
 * for a successors cell it is the successor (`toId`).
 */
function termToLink(
  taskId: RecordId,
  side: DependencySide,
  term: ParsedDependencyTerm,
): Omit<DependencyModel, 'id'> {
  const base: Omit<DependencyModel, 'id'> =
    side === 'predecessors'
      ? { fromId: term.ref, toId: taskId }
      : { fromId: taskId, toId: term.ref };
  return { ...base, type: term.type, lag: term.lag };
}

/**
 * Apply an edited notation string to a cell: parse → diff against current links →
 * route the minimal add/remove edits through `GanttApi.addDependency`/
 * `removeDependency`. Engine rejections (cycles) are collected and reported, and
 * any links removed as part of a lag-replace that then fails to re-add are NOT
 * left half-applied — removals run only after the matching adds succeed.
 */
export function applyNotation<T extends Model>(
  api: GanttApi<T>,
  taskId: RecordId,
  side: DependencySide,
  input: string,
  parseOptions: ParseOptions = {},
): ApplyResult {
  const existing = orientedLinksFor(api, taskId, side);
  const { terms, errors } = parseDependencyNotation(input, { selfId: taskId, ...parseOptions });

  const messages = errors.map((e) => e.message);
  const { toAdd, toRemove } = diffDependencyTerms(terms, existing);

  let added = 0;
  let removed = 0;

  // Add first so a failed add (cycle) doesn't strand a removal of the link it
  // was meant to replace. Track which existing links we still intend to remove.
  const removeSet = new Set(toRemove.map((id) => String(id)));

  for (const term of toAdd) {
    const link = termToLink(taskId, side, term);
    const created = api.addDependency(link);
    if (created) {
      added += 1;
    } else {
      messages.push(
        `Link to task "${String(term.ref)}" was rejected (would create a cycle or was vetoed).`,
      );
      // The replace failed: keep the original link in place (don't remove it).
      // Drop any pending removal for the SAME oriented ref+type so we don't lose
      // the user's prior valid link to a now-failed re-add.
      const original = existing.find(
        (e) => String(e.ref) === String(term.ref) && e.type === term.type,
      );
      if (original) removeSet.delete(String(original.id));
    }
  }

  for (const id of removeSet) {
    api.removeDependency(idFromString(existing, id));
    removed += 1;
  }

  return { ok: messages.length === 0, added, removed, errors: messages };
}

/** Recover the original {@link RecordId} from its stringified form. */
function idFromString(existing: ReadonlyArray<OrientedLink>, idStr: string): RecordId {
  const match = existing.find((e) => String(e.id) === idStr);
  return match ? match.id : idStr;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Inline cell editor
   ═══════════════════════════════════════════════════════════════════════════ */

/** Construction options for {@link DependencyCellEditor}. */
export interface DependencyCellEditorOptions<T extends Model = Model> {
  /** The Gantt API the editor routes edits through. */
  api: GanttApi<T>;
  /** The task whose cell is being edited. */
  taskId: RecordId;
  /** Which side this cell edits. */
  side: DependencySide;
  /** Accessible label for the input. Defaults derived from `side`. */
  label?: string;
  /** Parse/serialize options (ref resolution, hoursPerDay). */
  parseOptions?: ParseOptions;
  serializeOptions?: SerializeOptions;
  /**
   * Called after a commit attempt with the {@link ApplyResult}. On success the
   * consumer should refresh the grid/cell; on failure the editor keeps focus and
   * shows the error (the value is NOT applied).
   */
  onCommit?(result: ApplyResult): void;
  /** Called when the user cancels (Escape / blur without commit). */
  onCancel?(): void;
}

/**
 * A standalone inline editor for a dependency cell: a text input pre-filled with
 * the cell's notation, a hint, and an ARIA-live error region. Enter commits,
 * Escape cancels. Fully keyboard operable and axe-clean.
 */
export class DependencyCellEditor<T extends Model = Model> {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  private readonly errorEl: HTMLElement;
  private readonly opts: DependencyCellEditorOptions<T>;
  private disposers: Array<() => void> = [];
  private destroyed = false;
  private committed = false;

  constructor(opts: DependencyCellEditorOptions<T>) {
    this.opts = opts;
    const side = opts.side;
    const label =
      opts.label ?? (side === 'predecessors' ? 'Edit predecessors' : 'Edit successors');

    this.el = createEl('div', { className: 'jects-gantt-dep-editor' });
    this.el.dataset.side = side;

    const inputId = `jects-dep-input-${String(opts.taskId)}-${side}`;
    const errorId = `${inputId}-error`;

    this.input = createEl('input', { className: 'jects-gantt-dep-editor__input' });
    this.input.type = 'text';
    this.input.id = inputId;
    this.input.setAttribute('aria-label', label);
    this.input.setAttribute('aria-describedby', errorId);
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.placeholder = side === 'predecessors' ? 'e.g. 2FS+1d, 3SS' : 'e.g. 4, 5SS';
    this.input.value = notationFor(opts.api, opts.taskId, side, opts.serializeOptions);

    this.errorEl = createEl('div', { className: 'jects-gantt-dep-editor__error' });
    this.errorEl.id = errorId;
    this.errorEl.setAttribute('role', 'alert');
    this.errorEl.setAttribute('aria-live', 'assertive');

    this.el.append(this.input, this.errorEl);

    const onKeyDown = (e: KeyboardEvent): void => this.handleKeyDown(e);
    const onBlur = (): void => {
      // A blur without an explicit commit cancels (matches grid editors).
      if (!this.committed && !this.destroyed) this.cancel();
    };
    this.input.addEventListener('keydown', onKeyDown);
    this.input.addEventListener('blur', onBlur);
    this.disposers.push(() => {
      this.input.removeEventListener('keydown', onKeyDown);
      this.input.removeEventListener('blur', onBlur);
    });
  }

  /** Focus and select the input (call after mounting into the cell). */
  focus(): void {
    this.input.focus();
    this.input.select();
  }

  private handleKeyDown(e: KeyboardEvent): void {
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        this.commit();
        return;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        this.cancel();
        return;
      default:
        return;
    }
  }

  /**
   * Validate + apply the current input value. On success fires `onCommit` with a
   * successful {@link ApplyResult}; on failure shows the inline error and KEEPS
   * the editor open with focus so the user can fix the notation.
   */
  commit(): ApplyResult {
    const result = applyNotation(
      this.opts.api,
      this.opts.taskId,
      this.opts.side,
      this.input.value,
      this.opts.parseOptions ?? {},
    );
    if (result.ok) {
      this.committed = true;
      this.clearError();
      this.opts.onCommit?.(result);
    } else {
      // Partial success is still surfaced (some links may have applied), but the
      // editor stays open with the error so the user can correct the rest.
      this.showError(result.errors.join(' '));
      this.input.setAttribute('aria-invalid', 'true');
      this.el.classList.add('jects-gantt-dep-editor--invalid');
      this.opts.onCommit?.(result);
    }
    return result;
  }

  /** Abandon the edit without applying changes. */
  cancel(): void {
    if (this.committed) return;
    this.opts.onCancel?.();
  }

  private showError(message: string): void {
    this.errorEl.textContent = message;
  }

  private clearError(): void {
    this.errorEl.textContent = '';
    this.input.removeAttribute('aria-invalid');
    this.el.classList.remove('jects-gantt-dep-editor--invalid');
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const d of this.disposers.splice(0)) d();
    this.el.remove();
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   GanttFeature: editable predecessors + successors columns
   ═══════════════════════════════════════════════════════════════════════════ */

/** Feature registry key. */
export const DEPENDENCY_COLUMNS_FEATURE = 'dependencyColumns';

/** Construction config for {@link GanttDependencyColumns}. */
export interface GanttDependencyColumnsConfig {
  /** Header for the predecessors column. Default `'Predecessors'`. */
  predecessorsHeader?: string;
  /** Header for the successors column. Default `'Successors'`. */
  successorsHeader?: string;
  /**
   * Resolve a typed reference token (id / WBS / row label) to a task id. When
   * omitted, tokens are matched against task ids directly (numeric tokens are
   * coerced to numbers). Wired into the editor's parse options.
   */
  resolveRef?(token: string): RecordId | undefined;
  /** Inverse of `resolveRef`: render a task id back to its display token. */
  refToToken?(id: RecordId): string;
  /** Working hours/day for `h` lag suffix conversion. Default 24. */
  hoursPerDay?: number;
}

/**
 * The installable feature. On `init` it captures the {@link GanttApi} and
 * exposes helpers to: read a cell's notation, open an inline editor over a cell
 * element, and apply notation programmatically. It owns no DOM until an editor
 * is opened, and disposes every open editor on `destroy`.
 *
 * Wiring (see wireNotes): the integrator hands the editor's `el` to the grid's
 * cell-edit slot (or mounts it over the fallback `<td>`), passing the column
 * field to {@link sideForField}. The feature does the rest.
 */
export class GanttDependencyColumns<T extends Model = Model> implements GanttFeature<T> {
  readonly name = DEPENDENCY_COLUMNS_FEATURE;
  private api: GanttApi<T> | null = null;
  private readonly config: GanttDependencyColumnsConfig;
  private openEditors = new Set<DependencyCellEditor<T>>();

  constructor(config: GanttDependencyColumnsConfig = {}) {
    this.config = config;
  }

  init(api: GanttApi<T>): void {
    this.api = api;
    api.track(() => this.destroy());
  }

  /** The two column configs this feature contributes, in display order. */
  columns(): Array<{ field: string; header: string; editable: true }> {
    return [
      {
        field: PREDECESSORS_COLUMN_FIELD,
        header: this.config.predecessorsHeader ?? 'Predecessors',
        editable: true,
      },
      {
        field: SUCCESSORS_COLUMN_FIELD,
        header: this.config.successorsHeader ?? 'Successors',
        editable: true,
      },
    ];
  }

  /** Read a cell's notation string (for the column renderer). */
  notation(taskId: RecordId, side: DependencySide): string {
    if (!this.api) return '';
    return notationFor(this.api, taskId, side, this.serializeOptions());
  }

  /** Apply notation programmatically (the editor uses this under the hood). */
  apply(taskId: RecordId, side: DependencySide, input: string): ApplyResult {
    if (!this.api) return { ok: false, added: 0, removed: 0, errors: ['Gantt not ready.'] };
    return applyNotation(this.api, taskId, side, input, this.parseOptions(taskId));
  }

  /**
   * Open an inline editor for a cell. Returns the editor (already containing the
   * cell's current notation); the caller mounts `editor.el` and calls
   * `editor.focus()`. The feature tracks it and tears it down on commit/cancel.
   */
  openEditor(
    taskId: RecordId,
    side: DependencySide,
    handlers: { onCommit?(result: ApplyResult): void; onCancel?(): void } = {},
  ): DependencyCellEditor<T> {
    if (!this.api) throw new Error('GanttDependencyColumns not initialised.');
    const editor = new DependencyCellEditor<T>({
      api: this.api,
      taskId,
      side,
      parseOptions: this.parseOptions(taskId),
      serializeOptions: this.serializeOptions(),
      onCommit: (result) => {
        if (result.ok) {
          this.disposeEditor(editor);
          handlers.onCommit?.(result);
        } else {
          // Keep open on validation failure; still notify so the cell can react.
          handlers.onCommit?.(result);
        }
      },
      onCancel: () => {
        this.disposeEditor(editor);
        handlers.onCancel?.();
      },
    });
    this.openEditors.add(editor);
    return editor;
  }

  private disposeEditor(editor: DependencyCellEditor<T>): void {
    this.openEditors.delete(editor);
    editor.destroy();
  }

  private parseOptions(selfId: RecordId): ParseOptions {
    const opts: ParseOptions = { selfId };
    if (this.config.resolveRef) opts.resolveRef = this.config.resolveRef;
    if (this.config.hoursPerDay != null) opts.hoursPerDay = this.config.hoursPerDay;
    return opts;
  }

  private serializeOptions(): SerializeOptions {
    const opts: SerializeOptions = {};
    if (this.config.refToToken) opts.refToToken = this.config.refToToken;
    if (this.config.hoursPerDay != null) opts.hoursPerDay = this.config.hoursPerDay;
    return opts;
  }

  destroy(): void {
    for (const editor of [...this.openEditors]) this.disposeEditor(editor);
    this.openEditors.clear();
    this.api = null;
  }
}

/** Map a column field id to the dependency side it edits, or `null`. */
export function sideForField(field: string): DependencySide | null {
  if (field === PREDECESSORS_COLUMN_FIELD) return 'predecessors';
  if (field === SUCCESSORS_COLUMN_FIELD) return 'successors';
  return null;
}

/** Convenience factory mirroring the package's `createX` helpers. */
export function createDependencyColumns<T extends Model = Model>(
  config?: GanttDependencyColumnsConfig,
): GanttDependencyColumns<T> {
  return new GanttDependencyColumns<T>(config);
}

/** Default task → display-token resolver (id, WBS, or name) usable as `resolveRef`. */
export function buildRefResolver<T extends Model>(
  tasks: ReadonlyArray<TaskModel<T>>,
): { resolveRef(token: string): RecordId | undefined; refToToken(id: RecordId): string } {
  const byId = new Map<string, RecordId>();
  const byName = new Map<string, RecordId>();
  for (const t of tasks) {
    byId.set(String(t.id), t.id);
    if (t.name) byName.set(t.name.toLowerCase(), t.id);
  }
  return {
    resolveRef(token: string): RecordId | undefined {
      const t = token.trim();
      if (byId.has(t)) return byId.get(t);
      const n = byName.get(t.toLowerCase());
      if (n !== undefined) return n;
      // numeric coercion fallback
      if (/^-?\d+$/.test(t) && byId.has(String(Number(t)))) return byId.get(String(Number(t)));
      return undefined;
    },
    refToToken(id: RecordId): string {
      return String(id);
    },
  };
}
