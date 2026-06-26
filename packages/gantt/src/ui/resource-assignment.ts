/**
 * `@jects/gantt` — **Resource assignment** (the Bryntum/DHTMLX
 * resource-assignment UI). This module is the additive, contract-pure core that
 * the user-facing assignment surfaces route through:
 *
 *   1. {@link AssignmentStore} — the single source of truth for *who is assigned
 *      to what, and at what units %*. It is a thin, framework-free store over
 *      {@link ResourceModel}s and {@link AssignmentModel}s (the
 *      Scheduler/Bryntum `AssignmentStore` shape: one row per
 *      `(resource, task)` pair with a `units` percentage). Every assign /
 *      unassign / re-unit edit goes through it and fans out a typed `change`
 *      event so the tree column, the task editor, and the bar labels all stay in
 *      lockstep. It is DOM-free.
 *
 *   2. {@link renderAssignmentAvatars} / {@link assignmentLabelText} — pure
 *      renderers that turn a task's assignments into the *avatar/initials chips*
 *      shown in the task-tree "Resources" column and the *resource label* shown
 *      next to a task bar (Bryntum's `resourceMargin` labels). They are pure
 *      (string/DOM-builder) so they can be unit-tested in jsdom and reused by the
 *      tree-column renderer, the bar-label decorator, and the editor preview.
 *
 *   3. {@link AssignmentColumnRenderer} — a `@jects/grid`-compatible cell
 *      renderer for a task-tree column, and {@link GanttResourceLabelsFeature} —
 *      a `GanttFeature` plugin that decorates already-laid-out task bars with
 *      resource labels (it never edits the timeline renderer; it observes the
 *      bars layer like the Indicators feature does).
 *
 * Concurrency: everything here is NEW and additive. It does not edit the package
 * barrel, the main `Gantt` class, or any shared file. The owning widget wires it
 * in via the documented seams (see the module's wire notes / the field module).
 *
 * All times are epoch ms (UTC), consistent with the rest of @jects/gantt.
 */

import './resource-assignment.css';
import { createEl, EventEmitter, type Model, type RecordId } from '@jects/core';
import type { GanttApi, GanttFeature, TaskModel } from '../contract.js';
import type {
  ResourceModel as ResourceContractModel,
  AssignmentModel as AssignmentContractModel,
} from '../resource/resource-contract.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. RESOURCE + ASSIGNMENT MODELS (unified with the frozen resource contract)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A schedulable resource (a person, team, or piece of equipment) that can be
 * assigned to tasks. This is a RE-EXPORT of the single, frozen
 * {@link ResourceContractModel} from `../resource/resource-contract.ts` — there
 * is no longer a divergent UI-local model. The contract carries the display
 * hints this UI consumes (`initials`/`colorToken`/`role`/`image`/`maxUnits`).
 */
export type ResourceModel<Extra extends Model = Model> = ResourceContractModel<Extra>;

/**
 * A single `(resource → task)` assignment with an allocation percentage —
 * a RE-EXPORT of the frozen {@link AssignmentContractModel}. Many resources can
 * be assigned to one task and one resource to many tasks, each at its own `units`.
 */
export type AssignmentModel<Extra extends Model = Model> = AssignmentContractModel<Extra>;

/** The avatar palette token names cycled when a resource has no explicit colour. */
export const RESOURCE_AVATAR_TOKENS: readonly string[] = [
  'cmyk-cyan',
  'cmyk-magenta',
  'cmyk-yellow',
  'cmyk-key',
  'primary',
  'accent',
];

/* ═══════════════════════════════════════════════════════════════════════════
   2. ASSIGNMENT STORE EVENTS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Typed event map for {@link AssignmentStore}. */
export interface AssignmentStoreEvents extends Record<string, unknown> {
  /** A resource was assigned (or re-assigned at new units) to a task. */
  assign: { assignment: AssignmentModel };
  /** An assignment was removed. */
  unassign: { assignmentId: RecordId; taskId: RecordId; resourceId: RecordId };
  /** An assignment's units changed. */
  unitsChange: { assignment: AssignmentModel; previousUnits: number };
  /** The resource set was replaced. */
  resourcesChange: { resources: ReadonlyArray<ResourceModel> };
  /** Coarse "something changed" — fired after any mutation (UI repaint hook). */
  change: { action: 'assign' | 'unassign' | 'units' | 'resources' | 'load' };
}

/** What {@link AssignmentStore.setAssignmentsForTask} accepts per row. */
export interface TaskAssignmentInput {
  resourceId: RecordId;
  units?: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. ASSIGNMENT STORE
   ═══════════════════════════════════════════════════════════════════════════ */

/** Construction options for {@link AssignmentStore}. */
export interface AssignmentStoreOptions {
  /** Initial resource catalogue. */
  resources?: ResourceModel[];
  /** Initial assignments. */
  assignments?: AssignmentModel[];
  /** Id generator for new assignments (defaults to a monotonic counter). */
  generateId?: () => RecordId;
}

/**
 * The single source of truth for resource assignments. Framework-free and
 * DOM-free: it owns the resource catalogue and the `(resource, task)`
 * assignment rows, enforces one assignment per pair (re-assigning the same pair
 * updates units instead of duplicating), and emits typed change events the UI
 * subscribes to.
 *
 * It deliberately does NOT touch the `TaskModel.resourceIds` array — that field
 * is the engine's capacity hint; this store is the richer UI-facing model
 * (per-assignment units). The owning widget may mirror ids back to
 * `resourceIds` if it wants the engine to see them (see wire notes).
 */
export class AssignmentStore {
  /** Typed event bus (assign/unassign/units/resources/change). */
  readonly events = new EventEmitter<AssignmentStoreEvents>();

  private resourcesById = new Map<RecordId, ResourceModel>();
  private resourceOrder: RecordId[] = [];
  private assignmentsById = new Map<RecordId, AssignmentModel>();
  /** Fast lookup: taskId → set of assignment ids. */
  private byTask = new Map<RecordId, Set<RecordId>>();
  /** Fast lookup: resourceId → set of assignment ids. */
  private byResource = new Map<RecordId, Set<RecordId>>();
  private readonly generateId: () => RecordId;
  private seq = 0;

  constructor(opts: AssignmentStoreOptions = {}) {
    this.generateId = opts.generateId ?? (() => `a-${++this.seq}`);
    if (opts.resources) this.setResources(opts.resources, true);
    if (opts.assignments) {
      for (const a of opts.assignments) this.indexAssignment(this.normalize(a));
    }
    if (opts.resources || opts.assignments) {
      this.events.emit('change', { action: 'load' });
    }
  }

  /* ── resources ─────────────────────────────────────────────────────────── */

  /** Replace the resource catalogue. */
  setResources(resources: ReadonlyArray<ResourceModel>, silent = false): void {
    this.resourcesById = new Map();
    this.resourceOrder = [];
    for (const r of resources) {
      this.resourcesById.set(r.id, r);
      this.resourceOrder.push(r.id);
    }
    if (!silent) {
      this.events.emit('resourcesChange', { resources: this.getResources() });
      this.events.emit('change', { action: 'resources' });
    }
  }

  /** All resources, in catalogue order. */
  getResources(): ReadonlyArray<ResourceModel> {
    return this.resourceOrder.map((id) => this.resourcesById.get(id)!).filter(Boolean);
  }

  /** A resource by id. */
  getResource(id: RecordId): ResourceModel | undefined {
    return this.resourcesById.get(id);
  }

  /* ── assignment reads ────────────────────────────────────────────────────── */

  /** Every assignment row for a task (resource + units), in resource order. */
  getAssignmentsForTask(taskId: RecordId): AssignmentModel[] {
    const ids = this.byTask.get(taskId);
    if (!ids || ids.size === 0) return [];
    const rows: AssignmentModel[] = [];
    for (const id of ids) {
      const a = this.assignmentsById.get(id);
      if (a) rows.push(a);
    }
    // Stable order: by resource catalogue index, then by id.
    const order = new Map(this.resourceOrder.map((rid, i) => [rid, i] as const));
    rows.sort((x, y) => {
      const ox = order.get(x.resourceId) ?? Number.MAX_SAFE_INTEGER;
      const oy = order.get(y.resourceId) ?? Number.MAX_SAFE_INTEGER;
      if (ox !== oy) return ox - oy;
      return String(x.id).localeCompare(String(y.id));
    });
    return rows;
  }

  /** The resources assigned to a task (resolved + ordered). */
  getResourcesForTask(taskId: RecordId): ResourceModel[] {
    return this.getAssignmentsForTask(taskId)
      .map((a) => this.resourcesById.get(a.resourceId))
      .filter((r): r is ResourceModel => r != null);
  }

  /** Every task a resource is assigned to. */
  getTasksForResource(resourceId: RecordId): RecordId[] {
    const ids = this.byResource.get(resourceId);
    if (!ids) return [];
    const out: RecordId[] = [];
    for (const id of ids) {
      const a = this.assignmentsById.get(id);
      if (a) out.push(a.taskId);
    }
    return out;
  }

  /** The assignment row for a specific `(resource, task)` pair, if any. */
  getAssignment(taskId: RecordId, resourceId: RecordId): AssignmentModel | undefined {
    const ids = this.byTask.get(taskId);
    if (!ids) return undefined;
    for (const id of ids) {
      const a = this.assignmentsById.get(id);
      if (a && a.resourceId === resourceId) return a;
    }
    return undefined;
  }

  /** Whether a resource is assigned to a task. */
  isAssigned(taskId: RecordId, resourceId: RecordId): boolean {
    return this.getAssignment(taskId, resourceId) != null;
  }

  /** Total allocation (sum of units) a resource carries across all its tasks. */
  totalUnitsForResource(resourceId: RecordId): number {
    const ids = this.byResource.get(resourceId);
    if (!ids) return 0;
    let sum = 0;
    for (const id of ids) {
      const a = this.assignmentsById.get(id);
      if (a) sum += a.units ?? 100;
    }
    return sum;
  }

  /** True when a resource's total allocation exceeds its `maxUnits` (default 100). */
  isOverAllocated(resourceId: RecordId): boolean {
    const res = this.resourcesById.get(resourceId);
    const cap = res?.maxUnits ?? 100;
    return this.totalUnitsForResource(resourceId) > cap;
  }

  /* ── assignment mutations ──────────────────────────────────────────────── */

  /**
   * Assign a resource to a task (or update its units if already assigned).
   * Returns the resulting assignment. Idempotent per `(resource, task)` pair.
   */
  assign(taskId: RecordId, resourceId: RecordId, units = 100): AssignmentModel {
    const existing = this.getAssignment(taskId, resourceId);
    if (existing) {
      return this.setUnits(existing.id, units) ?? existing;
    }
    const assignment: AssignmentModel = {
      id: this.generateId(),
      taskId,
      resourceId,
      units: clampUnits(units),
    };
    this.indexAssignment(assignment);
    this.events.emit('assign', { assignment });
    this.events.emit('change', { action: 'assign' });
    return assignment;
  }

  /** Remove a single assignment by id. No-op when absent. */
  unassign(assignmentId: RecordId): void {
    const a = this.assignmentsById.get(assignmentId);
    if (!a) return;
    this.assignmentsById.delete(assignmentId);
    this.byTask.get(a.taskId)?.delete(assignmentId);
    this.byResource.get(a.resourceId)?.delete(assignmentId);
    this.events.emit('unassign', {
      assignmentId,
      taskId: a.taskId,
      resourceId: a.resourceId,
    });
    this.events.emit('change', { action: 'unassign' });
  }

  /** Remove the assignment for a `(resource, task)` pair, if present. */
  unassignResource(taskId: RecordId, resourceId: RecordId): void {
    const a = this.getAssignment(taskId, resourceId);
    if (a) this.unassign(a.id);
  }

  /** Change an assignment's units (percent). Returns the updated row, or undefined. */
  setUnits(assignmentId: RecordId, units: number): AssignmentModel | undefined {
    const a = this.assignmentsById.get(assignmentId);
    if (!a) return undefined;
    const previousUnits = a.units ?? 100;
    const next = clampUnits(units);
    if (next === previousUnits) return a;
    a.units = next;
    this.events.emit('unitsChange', { assignment: a, previousUnits });
    this.events.emit('change', { action: 'units' });
    return a;
  }

  /**
   * Replace ALL assignments for a task with the given set (the editor's "save"
   * path). Diffs against the current rows so only real changes fire events:
   * removes dropped resources, adds new ones, and re-units changed ones.
   */
  setAssignmentsForTask(taskId: RecordId, next: ReadonlyArray<TaskAssignmentInput>): void {
    const desired = new Map<RecordId, number>();
    for (const row of next) desired.set(row.resourceId, clampUnits(row.units ?? 100));

    // Remove assignments no longer desired.
    for (const current of this.getAssignmentsForTask(taskId)) {
      if (!desired.has(current.resourceId)) this.unassign(current.id);
    }
    // Add / update desired ones.
    for (const [resourceId, units] of desired) this.assign(taskId, resourceId, units);
  }

  /* ── internals ─────────────────────────────────────────────────────────── */

  private normalize(a: AssignmentModel): AssignmentModel {
    return { ...a, units: clampUnits(a.units ?? 100) };
  }

  private indexAssignment(a: AssignmentModel): void {
    this.assignmentsById.set(a.id, a);
    let t = this.byTask.get(a.taskId);
    if (!t) this.byTask.set(a.taskId, (t = new Set()));
    t.add(a.id);
    let r = this.byResource.get(a.resourceId);
    if (!r) this.byResource.set(a.resourceId, (r = new Set()));
    r.add(a.id);
  }
}

/** Clamp a units value to a sane non-negative integer-ish percentage. */
export function clampUnits(units: number): number {
  if (!Number.isFinite(units) || units < 0) return 0;
  return Math.round(units);
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. AVATAR / LABEL HELPERS (pure)
   ═══════════════════════════════════════════════════════════════════════════ */

/** A resource's display name (falls back to its id when `name` is unset). */
export function resourceName(resource: ResourceModel): string {
  return resource.name != null && resource.name !== '' ? resource.name : String(resource.id);
}

/** Initials for a resource (explicit, else derived from the name). */
export function resourceInitials(resource: ResourceModel): string {
  if (resource.initials && resource.initials.trim() !== '') {
    return resource.initials.trim().slice(0, 2).toUpperCase();
  }
  const words = resourceName(resource).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

/**
 * The deterministic avatar colour TOKEN name for a resource (explicit
 * `colorToken`, else a stable pick from {@link RESOURCE_AVATAR_TOKENS} keyed by
 * the id so the same resource always gets the same colour).
 */
export function resourceColorToken(resource: ResourceModel): string {
  if (resource.colorToken) return resource.colorToken;
  const key = String(resource.id);
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  const idx = Math.abs(hash) % RESOURCE_AVATAR_TOKENS.length;
  return RESOURCE_AVATAR_TOKENS[idx]!;
}

/**
 * Plain-text resource label for a task (e.g. for the bar label and the cell's
 * accessible text): comma-joined resource names, with a `+N` overflow when the
 * count exceeds `max`. Returns `''` when no resources.
 */
export function assignmentLabelText(resources: ReadonlyArray<ResourceModel>, max = 3): string {
  if (resources.length === 0) return '';
  if (resources.length <= max) return resources.map(resourceName).join(', ');
  const shown = resources.slice(0, max).map(resourceName).join(', ');
  return `${shown} +${resources.length - max}`;
}

/** Options for {@link renderAssignmentAvatars}. */
export interface AssignmentAvatarsOptions {
  /** Max avatar chips to render before collapsing to a `+N` overflow chip. */
  max?: number;
  /** Show the resource name beside the avatar (tree column). Default `true`. */
  showNames?: boolean;
  /** Show each assignment's units % beside the name. Default `false`. */
  showUnits?: boolean;
  /**
   * Optional predicate marking a resource as over-allocated; when it returns
   * true the chip gets the `--over` modifier (destructive ring) so the
   * over-allocation cue is visible in the tree column and bar labels too.
   */
  isOverAllocated?: (resource: ResourceModel) => boolean;
}

/**
 * Build a token-pure avatar/initials chip group for a task's assignments. Used
 * by the task-tree "Resources" column and (names-off) the bar label decorator.
 * Pure DOM builder — no listeners, no store coupling: callers pass already
 * resolved resources (+ optional units lookup).
 */
export function renderAssignmentAvatars(
  resources: ReadonlyArray<ResourceModel>,
  opts: AssignmentAvatarsOptions = {},
  unitsOf?: (resource: ResourceModel) => number | undefined,
): HTMLElement {
  const max = opts.max ?? 3;
  const showNames = opts.showNames ?? true;
  const showUnits = opts.showUnits ?? false;

  const wrap = createEl('span', { className: 'jects-gantt__assignees' });
  // The group's accessible name is the full comma-joined list so AT users hear
  // every assignee even when chips overflow into a `+N`.
  const fullText = assignmentLabelText(resources, resources.length);
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', fullText === '' ? 'No resources assigned' : `Assigned: ${fullText}`);

  const shown = resources.slice(0, max);
  for (const r of shown) {
    const over = opts.isOverAllocated?.(r) ?? false;
    const chip = createEl('span', {
      className: over ? 'jects-gantt__assignee jects-gantt__assignee--over' : 'jects-gantt__assignee',
    });
    const avatar = createEl('span', { className: 'jects-gantt__avatar' });
    avatar.style.setProperty('--jects-avatar-color', `oklch(var(--jects-${resourceColorToken(r)}))`);
    // Decorative: the assignee text/accessible name carries the identity.
    avatar.setAttribute('aria-hidden', 'true');
    if (r.image) {
      const img = createEl('img', { className: 'jects-gantt__avatar-img' }) as HTMLImageElement;
      img.src = r.image;
      img.alt = '';
      avatar.append(img);
    } else {
      avatar.textContent = resourceInitials(r);
    }
    chip.append(avatar);

    if (showNames) {
      const nameEl = createEl('span', { className: 'jects-gantt__assignee-name' });
      let text = resourceName(r);
      if (showUnits) {
        const u = unitsOf?.(r);
        if (u != null && u !== 100) text += ` (${u}%)`;
      }
      nameEl.textContent = text;
      chip.append(nameEl);
    }
    wrap.append(chip);
  }

  if (resources.length > max) {
    const more = createEl('span', { className: 'jects-gantt__assignee jects-gantt__assignee--more' });
    const badge = createEl('span', { className: 'jects-gantt__avatar jects-gantt__avatar--more' });
    badge.setAttribute('aria-hidden', 'true');
    badge.textContent = `+${resources.length - max}`;
    more.append(badge);
    wrap.append(more);
  }

  return wrap;
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. TASK-TREE COLUMN RENDERER
   ═══════════════════════════════════════════════════════════════════════════ */

/** The default field id / header for the assignment column. */
export const ASSIGNMENT_COLUMN_FIELD = 'resources';
export const ASSIGNMENT_COLUMN_HEADER = 'Resources';

/**
 * Build a `@jects/grid`-compatible cell renderer (and a fallback HTML-string
 * renderer) for the task-tree "Resources" column. The renderer reads live
 * assignments from the {@link AssignmentStore}, so it always reflects the latest
 * assign/unassign — the owning widget just needs to `refresh()` the tree after a
 * store `change` (see wire notes).
 */
export class AssignmentColumnRenderer<T extends Model = Model> {
  constructor(
    private readonly store: AssignmentStore,
    private readonly opts: AssignmentAvatarsOptions = {},
  ) {}

  /** Render the cell for a task to a detached element (grid `renderer` form). */
  renderCell(task: TaskModel<T>): HTMLElement {
    const resources = this.store.getResourcesForTask(task.id);
    return renderAssignmentAvatars(resources, this.opts, (r) => {
      const a = this.store.getAssignment(task.id, r.id);
      return a?.units;
    });
  }

  /** Plain-text form (the grid's string renderer + the a11y fallback table). */
  renderText(task: TaskModel<T>): string {
    return assignmentLabelText(
      this.store.getResourcesForTask(task.id),
      this.opts.max ?? 3,
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. BAR RESOURCE-LABEL FEATURE (GanttFeature plugin)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Configuration for {@link GanttResourceLabelsFeature}. */
export interface GanttResourceLabelsConfig {
  /** The assignment store the labels read from. */
  store: AssignmentStore;
  /** Where the label sits relative to the bar. Default `'after'`. */
  position?: 'after' | 'below';
  /** Max names before a `+N` overflow. Default `2`. */
  max?: number;
  /** Render avatar chips (true) or just text (false). Default `true`. */
  avatars?: boolean;
}

/**
 * `GanttResourceLabelsFeature` — decorates already-laid-out task bars with a
 * resource label (Bryntum's `resourceMargin`/labels), reading from the
 * {@link AssignmentStore}. Like the Indicators feature it observes the bars
 * layer with a `MutationObserver` and re-decorates after every repaint, so it
 * survives drags, reschedules and expand/collapse without coupling to a specific
 * event or editing the timeline renderer. Pure `GanttApi` usage; leak-safe.
 */
export class GanttResourceLabelsFeature<T extends Model = Model> implements GanttFeature<T> {
  readonly name = 'resourceLabels';
  private api: GanttApi<T> | null = null;
  private observer: MutationObserver | null = null;
  private barsLayer: HTMLElement | null = null;
  private storeOff: (() => void) | null = null;
  private destroyed = false;

  constructor(private readonly config: GanttResourceLabelsConfig) {}

  init(api: GanttApi<T>): void {
    // Re-init after destroy() (instance reuse) must start clean — otherwise the
    // `destroyed` guard in decorateAll() early-returns forever and the feature
    // silently renders no resource labels. Matches indicators.ts/progress-line.ts.
    this.destroyed = false;
    this.api = api;
    const layer = api.el.querySelector('.jects-gantt__bars') as HTMLElement | null;
    this.barsLayer = layer;
    if (layer) {
      this.decorateAll();
      const observer = new MutationObserver(() => this.decorateAll());
      observer.observe(layer, { childList: true });
      this.observer = observer;
    }
    // Re-decorate when assignments change.
    this.storeOff = this.config.store.events.on('change', () => this.decorateAll());
    api.track(() => this.destroy());
  }

  /** Re-apply labels to every currently-rendered bar. */
  private decorateAll(): void {
    if (this.destroyed || !this.barsLayer || !this.api) return;
    const bars = this.barsLayer.querySelectorAll<HTMLElement>('.jects-gantt__bar');
    for (const barEl of bars) this.decorateBar(barEl);
  }

  private decorateBar(barEl: HTMLElement): void {
    if (!this.api) return;
    // Remove any prior label (idempotent across repaints).
    barEl.querySelector('.jects-gantt__bar-resources')?.remove();

    const idStr = barEl.dataset.taskId;
    if (idStr == null) return;
    const task = this.findTask(idStr);
    if (!task) return;

    const resources = this.config.store.getResourcesForTask(task.id);
    if (resources.length === 0) return;

    const position = this.config.position ?? 'after';
    const label = createEl('span', {
      className: `jects-gantt__bar-resources jects-gantt__bar-resources--${position}`,
    });
    // Decorative within the bar (the bar already names the task); expose the
    // assignee text as a title so a hovering/AT user can read it.
    label.setAttribute('aria-hidden', 'true');
    if (this.config.avatars ?? true) {
      label.append(
        renderAssignmentAvatars(
          resources,
          { max: this.config.max ?? 2, showNames: position === 'after' },
        ),
      );
    } else {
      label.textContent = assignmentLabelText(resources, this.config.max ?? 2);
    }
    label.title = assignmentLabelText(resources, resources.length);
    barEl.append(label);
  }

  private findTask(idStr: string): TaskModel<T> | undefined {
    if (!this.api) return undefined;
    // Resolve the original id type via the engine (ids may be numeric).
    const direct = this.api.getTask(idStr as RecordId);
    if (direct) return direct;
    const num = Number(idStr);
    if (!Number.isNaN(num)) return this.api.getTask(num as RecordId);
    return undefined;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.observer?.disconnect();
    this.observer = null;
    this.storeOff?.();
    this.storeOff = null;
    // Strip any labels we added.
    this.barsLayer
      ?.querySelectorAll('.jects-gantt__bar-resources')
      .forEach((el) => el.remove());
    this.barsLayer = null;
    this.api = null;
  }
}
