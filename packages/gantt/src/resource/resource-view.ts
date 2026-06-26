/**
 * `ResourceView` — the visible **resources pane** for the Gantt (Bryntum/DHTMLX
 * "Resources" / "Resource view" parity). It renders the project's resources as a
 * flat list, **grouped by the `group` field** (department/role), each row showing
 * an **avatar/image**, the resource name + type, its **capacity**, **hourly cost**,
 * and a live **allocation bar** that flags **over-allocation**. Each row is a drag
 * source: dragging a resource onto a task (a drop target registered via
 * {@link ResourceView.dropTarget}) **assigns** that resource to the task through the
 * `ResourceApi`.
 *
 * It is presentation-only and ADDITIVE: it owns its own `Widget` + CSS and reaches
 * the model exclusively through the public `ResourceApi` (it never mutates a store
 * directly and never touches the `Gantt` class). It repaints on the manager's
 * resource/assignment events so capacity/cost/allocation stay live.
 *
 * Accessibility: the pane is a `listbox`-flavoured grouped list — a `tree`-free,
 * roving-tabindex list with `role=group` buckets, `role=listitem` rows, full
 * keyboard navigation (Up/Down/Home/End), and a keyboard assignment affordance
 * (Enter/Space emits `resourceActivate`, the keyboard-equivalent of a drop) so the
 * feature is operable without a pointer.
 */

import './resource-view.css';
import {
  Widget,
  createEl,
  register,
  type Model,
  type RecordId,
  type WidgetConfig,
  type WidgetEvents,
} from '@jects/core';
import type {
  ResourceModel,
  ResourceApi,
  ResourceType,
} from './resource-contract.js';
import { initials } from './resource-assignment-view.js';

const BLOCK = 'jects-resource-view';
/** Marks the payload of a resource drag (resource id) for drop targets. */
export const RESOURCE_DND_MIME = 'application/x-jects-resource-id';
const FULL_UNITS = 100;

/* ═══════════════════════════════════════════════════════════════════════════
   CONFIG / EVENTS
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ResourceViewConfig<
  T extends Model = Model,
  R extends Model = Model,
> extends WidgetConfig {
  /** The resource surface to read/assign through. */
  api: ResourceApi<T, R>;
  /** Accessible label for the pane. Default `'Resources'`. */
  label?: string;
  /**
   * Show the group buckets (`role=group` with a header). When `false`, all
   * resources render as one flat list. Default `true`.
   */
  grouped?: boolean;
  /** Label for the bucket holding resources with no `group`. Default `'Ungrouped'`. */
  ungroupedLabel?: string;
  /** Show the capacity figure on each row. Default `true`. */
  showCapacity?: boolean;
  /** Show the hourly cost figure on each row. Default `true`. */
  showCost?: boolean;
  /** Show the allocation bar on each row. Default `true`. */
  showAllocation?: boolean;
  /**
   * Currency formatter for the cost figure. Default formats as `$N/h` with the
   * value rounded to a whole number; override for locale/currency.
   */
  formatCost?: (hourlyCost: number, resource: ResourceModel<R>) => string;
  /**
   * Enable HTML5 drag-to-assign from each row. Default `true`. When `false`, rows
   * are not draggable (keyboard activation still works).
   */
  draggable?: boolean;
}

export interface ResourceViewEvents<R extends Model = Model> extends WidgetEvents {
  /** A resource row was activated (click / Enter / Space) — keyboard assign hook. */
  resourceActivate: { resource: ResourceModel<R>; native: Event };
  /** A drag of a resource row started (native dragstart). */
  resourceDragStart: { resource: ResourceModel<R>; native: DragEvent };
  /** A drag of a resource row ended. */
  resourceDragEnd: { resource: ResourceModel<R>; native: DragEvent };
  /**
   * A resource was dropped on a registered drop target and assigned. Fired AFTER
   * the assignment succeeded (vetoes/failures do not fire this).
   */
  resourceAssignDrop: { resourceId: RecordId; taskId: RecordId };
}

/** Options for registering a DOM element as a drop target for resource drags. */
export interface ResourceDropTargetOptions {
  /** Resolve the task id a drop on `el` should assign to. */
  taskId: RecordId | ((event: DragEvent) => RecordId | undefined);
  /** Allocation (percentage) for the created assignment. Default `100`. */
  units?: number;
  /** CSS class toggled on `el` while a resource is dragged over it. Default highlight class. */
  overClass?: string;
}

/* ═══════════════════════════════════════════════════════════════════════════
   WIDGET
   ═══════════════════════════════════════════════════════════════════════════ */

export class ResourceView<
  T extends Model = Model,
  R extends Model = Model,
> extends Widget<ResourceViewConfig<T, R>, ResourceViewEvents<R>> {
  // NOTE: `declare` (no runtime field emit). The base `Widget` constructor calls
  // `render()` DURING `super()`, before subclass field initializers run. Under
  // `useDefineForClassFields`, even an initializer-less `private rows!: …` field
  // re-emits as `undefined` AFTER `super()` and would wipe what `render()`
  // populated. `declare` tells TS to emit no field at all, so `render()`'s
  // assignments survive. `render()` (re)assigns both at its top.
  /** id → row element, rebuilt each render, for cheap focus/roving management. */
  private declare rows: HTMLElement[];
  /** The resource id of the row holding the roving tabindex (the focusable one). */
  private declare activeId: RecordId | null | undefined;

  protected override defaults(): Partial<ResourceViewConfig<T, R>> {
    return {
      label: 'Resources',
      grouped: true,
      ungroupedLabel: 'Ungrouped',
      showCapacity: true,
      showCost: true,
      showAllocation: true,
      draggable: true,
    } as Partial<ResourceViewConfig<T, R>>;
  }

  protected buildEl(): HTMLElement {
    const el = createEl('div', { className: BLOCK });
    // Arrow-key navigation across rows (roving tabindex). Bound on the local root
    // here (this.el is not assigned until buildEl returns) and tracked for removal.
    const onKeyDown = (e: Event): void => this.onKeyDown(e as KeyboardEvent);
    el.addEventListener('keydown', onKeyDown);
    this.track(() => el.removeEventListener('keydown', onKeyDown));
    return el;
  }

  protected override render(): void {
    const cfg = this.config;
    const grouped = cfg.grouped !== false;
    // ARIA structure (valid list semantics):
    //  - flat:    root is role=list, rows are role=listitem.
    //  - grouped: root is a labelled role=group region; each bucket is its OWN
    //             role=list (header sits OUTSIDE the list as a sibling) so a list
    //             only ever contains listitems (axe aria-required-children).
    this.el.setAttribute('role', grouped ? 'group' : 'list');
    this.el.setAttribute('aria-label', cfg.label ?? 'Resources');
    this.el.replaceChildren();
    this.rows = [];

    const resources = cfg.api.getResources();
    if (resources.length === 0) {
      // No list semantics with zero items — present as a labelled group region so
      // an empty `role=list` never holds a non-listitem child (axe-clean).
      this.el.setAttribute('role', 'group');
      const empty = createEl('div', { className: `${BLOCK}__empty`, text: 'No resources' });
      this.el.append(empty);
      return;
    }

    // Re-validate the roving target (a previously active resource may be gone).
    if (this.activeId == null || !resources.some((r) => r.id === this.activeId)) {
      this.activeId = resources[0]!.id;
    }

    if (grouped) {
      for (const [groupName, members] of this.bucketByGroup(resources)) {
        this.el.append(this.buildGroup(groupName, members));
      }
    } else {
      for (const r of resources) this.el.append(this.buildRow(r));
    }
  }

  /* ── grouping ─────────────────────────────────────────────────────────── */

  /** Bucket resources by their `group` field, preserving insertion order. */
  private bucketByGroup(
    resources: ReadonlyArray<ResourceModel<R>>,
  ): Map<string, ResourceModel<R>[]> {
    const ungrouped = this.config.ungroupedLabel ?? 'Ungrouped';
    const out = new Map<string, ResourceModel<R>[]>();
    for (const r of resources) {
      const key = typeof r.group === 'string' && r.group.length > 0 ? r.group : ungrouped;
      const bucket = out.get(key) ?? out.set(key, []).get(key)!;
      bucket.push(r);
    }
    return out;
  }

  private buildGroup(name: string, members: ResourceModel<R>[]): HTMLElement {
    const group = createEl('div', { className: `${BLOCK}__group` });
    const headerId = `${this.id}-grp-${cssSafe(name)}`;
    const header = createEl('div', { className: `${BLOCK}__group-header`, text: name });
    header.id = headerId;
    const count = createEl('span', {
      className: `${BLOCK}__group-count`,
      text: String(members.length),
    });
    count.setAttribute('aria-hidden', 'true');
    header.append(count);
    group.append(header);
    // The rows live in their OWN list, labelled by the (sibling) header, so the
    // list contains only listitems.
    const list = createEl('div', { className: `${BLOCK}__group-list` });
    list.setAttribute('role', 'list');
    list.setAttribute('aria-labelledby', headerId);
    for (const r of members) list.append(this.buildRow(r));
    group.append(list);
    return group;
  }

  /* ── row ──────────────────────────────────────────────────────────────── */

  private buildRow(resource: ResourceModel<R>): HTMLElement {
    const cfg = this.config;
    const api = cfg.api;
    const over = api.isOverAllocated(resource.id);
    const name = (resource.name as string | undefined) ?? String(resource.id);

    const row = createEl('div', {
      className: `${BLOCK}__row${over ? ` ${BLOCK}__row--over` : ''}`,
    });
    row.setAttribute('role', 'listitem');
    row.dataset.resourceId = String(resource.id);
    // Roving tabindex: only the active row is in the tab order.
    row.tabIndex = resource.id === this.activeId ? 0 : -1;

    // Avatar: image when provided, else initials chip.
    row.append(this.buildAvatar(resource, name));

    // Main column: name + type + (capacity/cost) meta.
    const main = createEl('div', { className: `${BLOCK}__main` });
    const nameEl = createEl('div', { className: `${BLOCK}__name`, text: name });
    main.append(nameEl);
    const meta = this.buildMeta(resource);
    if (meta) main.append(meta);
    row.append(main);

    // Allocation bar (units summed across tasks vs capacity·100).
    const ariaParts = [name, typeLabel(resource.type)];
    if (cfg.showAllocation !== false && resource.type !== 'cost') {
      const { bar, pct } = this.buildAllocation(resource, over);
      row.append(bar);
      ariaParts.push(`${pct}% allocated`);
    }
    if (over) ariaParts.push('over-allocated');
    row.setAttribute('aria-label', ariaParts.filter(Boolean).join(', '));

    this.wireRow(row, resource);
    this.rows.push(row);
    return row;
  }

  private buildAvatar(resource: ResourceModel<R>, name: string): HTMLElement {
    const image = resource.image as string | undefined;
    if (typeof image === 'string' && image.length > 0) {
      const img = createEl('img', { className: `${BLOCK}__avatar ${BLOCK}__avatar--img` });
      (img as HTMLImageElement).src = image;
      (img as HTMLImageElement).alt = '';
      img.setAttribute('aria-hidden', 'true');
      return img;
    }
    const avatar = createEl('span', { className: `${BLOCK}__avatar`, text: initials(name) });
    avatar.setAttribute('aria-hidden', 'true');
    return avatar;
  }

  private buildMeta(resource: ResourceModel<R>): HTMLElement | null {
    const cfg = this.config;
    const meta = createEl('div', { className: `${BLOCK}__meta` });
    let any = false;

    // Type pill (work / equipment / material / cost).
    const type = createEl('span', {
      className: `${BLOCK}__type ${BLOCK}__type--${resource.type ?? 'work'}`,
      text: typeLabel(resource.type),
    });
    type.setAttribute('aria-hidden', 'true');
    meta.append(type);
    any = true;

    if (cfg.showCapacity !== false && resource.type !== 'cost') {
      const cap = resource.capacity ?? 1;
      const capEl = createEl('span', {
        className: `${BLOCK}__capacity`,
        text: `${formatNumber(cap)}× cap`,
      });
      capEl.setAttribute('aria-hidden', 'true');
      meta.append(capEl);
    }

    if (cfg.showCost !== false) {
      const hourly = resource.hourlyCost;
      if (typeof hourly === 'number' && Number.isFinite(hourly) && hourly > 0) {
        const fmt = cfg.formatCost ?? defaultFormatCost;
        const costEl = createEl('span', {
          className: `${BLOCK}__cost`,
          text: fmt(hourly, resource),
        });
        costEl.setAttribute('aria-hidden', 'true');
        meta.append(costEl);
      }
    }

    return any ? meta : null;
  }

  private buildAllocation(
    resource: ResourceModel<R>,
    over: boolean,
  ): { bar: HTMLElement; pct: number } {
    const api = this.config.api;
    const allocated = api.allocationOf(resource.id); // summed units
    const capacityUnits = Math.max(1, (resource.capacity ?? 1) * FULL_UNITS);
    const pct = Math.round((allocated / capacityUnits) * 100);
    const bar = createEl('div', {
      className: `${BLOCK}__alloc${over ? ` ${BLOCK}__alloc--over` : ''}`,
    });
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', String(Math.min(100, pct)));
    bar.setAttribute('aria-label', `${resource.name ?? resource.id} allocation`);
    const fill = createEl('span', { className: `${BLOCK}__alloc-fill` });
    // Cap the visual width at 100% (the --over modifier signals the overflow).
    fill.style.inlineSize = `${Math.min(100, pct)}%`;
    bar.append(fill);
    const label = createEl('span', { className: `${BLOCK}__alloc-label`, text: `${pct}%` });
    label.setAttribute('aria-hidden', 'true');
    bar.append(label);
    return { bar, pct };
  }

  /* ── interaction wiring ───────────────────────────────────────────────── */

  private wireRow(row: HTMLElement, resource: ResourceModel<R>): void {
    const cfg = this.config;

    const activate = (native: Event): void => {
      this.setActive(resource.id);
      this.emit('resourceActivate', { resource, native });
    };
    row.addEventListener('click', activate);

    if (cfg.draggable !== false) {
      row.draggable = true;
      row.addEventListener('dragstart', (e) => {
        const dt = (e as DragEvent).dataTransfer;
        if (dt) {
          dt.setData(RESOURCE_DND_MIME, String(resource.id));
          // text/plain fallback so generic drop zones still receive the id.
          dt.setData('text/plain', String(resource.id));
          dt.effectAllowed = 'copy';
        }
        row.classList.add(`${BLOCK}__row--dragging`);
        this.emit('resourceDragStart', { resource, native: e as DragEvent });
      });
      row.addEventListener('dragend', (e) => {
        row.classList.remove(`${BLOCK}__row--dragging`);
        this.emit('resourceDragEnd', { resource, native: e as DragEvent });
      });
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    const target = (e.target as HTMLElement | null)?.closest<HTMLElement>(`.${BLOCK}__row`);
    if (!target) return;

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const id = target.dataset.resourceId;
      const resource = id != null ? this.config.api.getResource(coerceId(id)) : undefined;
      if (resource) {
        this.setActive(resource.id);
        this.emit('resourceActivate', { resource, native: e });
      }
      return;
    }

    const nav: Record<string, number | 'first' | 'last'> = {
      ArrowDown: 1,
      ArrowUp: -1,
      Home: 'first',
      End: 'last',
    };
    const move = nav[e.key];
    if (move === undefined) return;
    e.preventDefault();
    const idx = this.rows.indexOf(target);
    if (idx < 0) return;
    let next: number;
    if (move === 'first') next = 0;
    else if (move === 'last') next = this.rows.length - 1;
    else next = Math.min(this.rows.length - 1, Math.max(0, idx + move));
    const nextRow = this.rows[next];
    if (nextRow) {
      const id = nextRow.dataset.resourceId;
      if (id != null) this.setActive(coerceId(id));
      nextRow.focus();
    }
  }

  /** Move the roving tabindex to a resource row (keeping exactly one focusable). */
  private setActive(id: RecordId): void {
    this.activeId = id;
    for (const row of this.rows) {
      const match = row.dataset.resourceId === String(id);
      row.tabIndex = match ? 0 : -1;
    }
  }

  /* ── drop-target registration (drag-to-assign) ────────────────────────── */

  /**
   * Register `el` (a task bar / task row) as a drop target: dropping a resource
   * dragged out of this view onto `el` calls `api.assign(taskId, resourceId)` and
   * emits `resourceAssignDrop`. Returns a disposer; it is also tracked so the
   * widget's `destroy()` removes the listeners (leak-safe).
   */
  dropTarget(el: HTMLElement, options: ResourceDropTargetOptions): () => void {
    const overClass = options.overClass ?? `${BLOCK}-drop-over`;
    const units = options.units ?? FULL_UNITS;

    const resolveTask = (event: DragEvent): RecordId | undefined =>
      typeof options.taskId === 'function' ? options.taskId(event) : options.taskId;

    const isResourceDrag = (e: DragEvent): boolean => {
      const types = e.dataTransfer?.types;
      // During dragover some browsers expose only `types`; accept our mime or
      // (as a fallback) any drag while one of our rows is mid-drag.
      if (types && Array.prototype.includes.call(types, RESOURCE_DND_MIME)) return true;
      return this.el.querySelector(`.${BLOCK}__row--dragging`) != null;
    };

    const onOver = (e: Event): void => {
      const de = e as DragEvent;
      if (!isResourceDrag(de)) return;
      de.preventDefault(); // allow drop
      if (de.dataTransfer) de.dataTransfer.dropEffect = 'copy';
      el.classList.add(overClass);
    };
    const onLeave = (): void => el.classList.remove(overClass);
    const onDrop = (e: Event): void => {
      const de = e as DragEvent;
      el.classList.remove(overClass);
      const raw =
        de.dataTransfer?.getData(RESOURCE_DND_MIME) ||
        de.dataTransfer?.getData('text/plain') ||
        '';
      if (!raw) return;
      const taskId = resolveTask(de);
      if (taskId == null) return;
      de.preventDefault();
      const resourceId = coerceId(raw);
      const assignment = this.config.api.assign(taskId, resourceId, units);
      if (assignment) this.emit('resourceAssignDrop', { resourceId, taskId });
    };

    el.addEventListener('dragover', onOver);
    el.addEventListener('dragleave', onLeave);
    el.addEventListener('drop', onDrop);
    const dispose = (): void => {
      el.removeEventListener('dragover', onOver);
      el.removeEventListener('dragleave', onLeave);
      el.removeEventListener('drop', onDrop);
      el.classList.remove(overClass);
    };
    this.track(dispose);
    return dispose;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS (pure — exported for testing)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Human label for a resource type. */
export function typeLabel(type: ResourceType | undefined): string {
  switch (type) {
    case 'equipment':
      return 'Equipment';
    case 'material':
      return 'Material';
    case 'cost':
      return 'Cost';
    case 'work':
    default:
      return 'Work';
  }
}

/** Default cost formatter: `$N/h` rounded to a whole number. */
export function defaultFormatCost(hourlyCost: number): string {
  return `$${formatNumber(Math.round(hourlyCost))}/h`;
}

/** Compact number formatting (drops trailing `.0`). */
function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** Coerce a stringified id back to a number when it round-trips losslessly. */
function coerceId(raw: string): RecordId {
  if (raw === '') return raw;
  const n = Number(raw);
  return Number.isFinite(n) && String(n) === raw ? n : raw;
}

/** Sanitize a group name into a class/id-safe token. */
function cssSafe(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase() || 'x';
}

register(
  'resourceView',
  ResourceView as unknown as new (
    host: HTMLElement | string,
    config?: Record<string, unknown>,
  ) => ResourceView,
);
