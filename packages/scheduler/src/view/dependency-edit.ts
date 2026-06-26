/**
 * Dependency drawing / editing UI (`dependenciesEditable`).
 *
 * Brings the Scheduler to Bryntum/DHTMLX dependency-editing parity. The config
 * flag + `beforeDependencyCreate`/`dependencyCreate` events already existed, but
 * there was NO interaction — no terminals, no drag-to-link, no delete. This
 * module is that interaction layer, packaged as a self-contained controller so it
 * can be wired into `Scheduler` additively (a plugin/mixin seam) without rewriting
 * the main class.
 *
 * What it adds, matching the reference products:
 *
 *  - **Hover terminals** — when the pointer enters an editable bar, two small
 *    circular handles appear at its start + end edges (the link anchor points).
 *  - **Drag-to-link** — pressing a terminal and dragging to another bar's
 *    terminal draws a live rubber-band line; releasing over a target terminal
 *    creates a dependency. The precedence TYPE is INFERRED from which terminals
 *    were grabbed:
 *        from 'end'   → to 'start'  = FS (finish-to-start, the default)
 *        from 'start' → to 'start'  = SS
 *        from 'end'   → to 'end'    = FF
 *        from 'start' → to 'end'    = SF
 *  - **Veto + emit** — a candidate link fires the vetoable `beforeDependencyCreate`
 *    (house veto convention); if not vetoed it is written into the dependency
 *    **Store** (not a plain array) and `dependencyCreate` is emitted.
 *  - **Cycle / duplicate guards** — a self-link, a duplicate link, or a link that
 *    would close a directed cycle is refused (announced, no store mutation).
 *  - **Select + delete** — clicking a dependency line selects it (and exposes a
 *    delete affordance); pressing Delete/Backspace, or invoking `deleteSelected`,
 *    removes it from the store with a vetoable `beforeDependencyDelete` +
 *    `dependencyDelete` emit.
 *
 * The controller never reaches into Scheduler internals beyond a small typed
 * {@link DependencyEditHost} adapter (axis projection, the visible bars + row
 * offsets, the SVG/bars layers, the store, and an `emit`/`announce`/`repaint`
 * surface). That keeps it unit-testable in isolation and keeps the wiring in
 * `scheduler.ts` purely additive.
 */

import {
  Disposers,
  addListener,
  terminalPoint,
  type TimeAxis,
  type EventBar,
  type DependencyTerminal,
} from '@jects/timeline-core';
import type { RecordId } from '@jects/core';

import type { DependencyModel, DependencyType, EventModel } from '../contract.js';
import {
  hasDependency,
  wouldCreateCycle,
  type DependencyStore,
} from '../stores/dependency-store.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Map a (fromSide, toSide) terminal pair to its precedence type. */
export function inferDependencyType(
  fromSide: DependencyTerminal,
  toSide: DependencyTerminal,
): DependencyType {
  if (fromSide === 'end' && toSide === 'start') return 'FS';
  if (fromSide === 'start' && toSide === 'start') return 'SS';
  if (fromSide === 'end' && toSide === 'end') return 'FF';
  return 'SF'; // start → end
}

/** A bar terminal the gesture is anchored on / hovering over. */
interface TerminalRef {
  barId: RecordId;
  side: DependencyTerminal;
  bar: EventBar<EventModel>;
}

/**
 * The slice of `Scheduler` the dependency editor needs. Implemented by the host
 * widget (an adapter object), so the controller stays decoupled + unit-testable.
 */
export interface DependencyEditHost {
  /** Current time⇄pixel projection. */
  readonly axis: TimeAxis;
  /** The bars currently laid out, keyed by bar id (incl. occurrences). */
  readonly visibleBars: ReadonlyMap<RecordId, EventBar<EventModel>>;
  /** Absolute content-y (top) of each resource row, by resource id. */
  readonly rowTops: ReadonlyMap<RecordId, number>;
  /** Reactive store the editor writes created/deleted links into. */
  readonly dependencyStore: DependencyStore;
  /** The bars layer (terminals are mounted here, over the bars). */
  readonly barsLayer: HTMLElement;
  /** The SVG dependency layer (rubber-band + hit-test overlay mount here). */
  readonly depsLayer: SVGSVGElement;
  /** Map a clientX/clientY to content-space coordinates. */
  toContentX(clientX: number): number;
  toContentY(clientY: number): number;
  /** Emit a typed scheduler event (delegated to the widget's EventEmitter). */
  emit(event: string, payload: unknown): boolean;
  /** Announce a message to assistive tech (polite live region). */
  announce(message: string): void;
  /** Request a full repaint (after a store mutation). */
  repaint(): void;
}

/**
 * The dependency drawing / editing controller. One per Scheduler; created only
 * when `dependenciesEditable` is on. Owns its DOM (terminal handles, the live
 * rubber-band path), all listeners, and the selection state — every one of which
 * is released by {@link destroy} so nothing leaks past the widget's life.
 */
export class DependencyEditController {
  private readonly disposers = new Disposers();
  /** Terminal handle elements currently mounted (for the hovered bar). */
  private terminalEls: HTMLElement[] = [];
  /** The bar id whose terminals are currently shown. */
  private hoveredBarId: RecordId | null = null;
  /** Live drag state, when a link is being drawn. */
  private drag: {
    from: TerminalRef;
    rubber: SVGPathElement;
    target: TerminalRef | null;
  } | null = null;
  /** The currently selected dependency id (for delete). */
  private selectedId: RecordId | null = null;
  private destroyed = false;

  constructor(private readonly host: DependencyEditHost) {
    // Terminal hover: show handles when the pointer enters an editable bar.
    this.disposers.add(
      addListener(host.barsLayer, 'pointerover', (e) => this.onBarPointerOver(e)),
    );
    this.disposers.add(
      addListener(host.barsLayer, 'pointerout', (e) => this.onBarPointerOut(e)),
    );
    // Click a dependency line to select it (the SVG layer hit-tests the paths).
    this.disposers.add(
      addListener(host.depsLayer as unknown as HTMLElement, 'click', (e) =>
        this.onDepClick(e as unknown as MouseEvent),
      ),
    );
    // Keyboard delete of the selected dependency.
    this.disposers.add(
      addListener(host.depsLayer as unknown as HTMLElement, 'keydown', (e) =>
        this.onDepKeyDown(e as unknown as KeyboardEvent),
      ),
    );
  }

  /* ── terminal rendering ────────────────────────────────────────────────── */

  /**
   * (Re)mount the two terminal handles for a bar. Called on hover and re-called
   * after a repaint while a bar stays hovered, so the handles track the bar's
   * box. Occurrence / non-editable bars get no terminals (they cannot be linked
   * from without an exception model).
   */
  showTerminalsFor(barId: RecordId): void {
    if (this.destroyed) return;
    const bar = this.host.visibleBars.get(barId);
    if (!bar || bar.event.editable === false) {
      this.clearTerminals();
      return;
    }
    this.hoveredBarId = barId;
    this.clearTerminals();
    for (const side of ['start', 'end'] as const) {
      const handle = this.makeTerminal(bar, side);
      this.host.barsLayer.appendChild(handle);
      this.terminalEls.push(handle);
    }
  }

  private makeTerminal(bar: EventBar<EventModel>, side: DependencyTerminal): HTMLElement {
    const rowTop = this.host.rowTops.get(bar.event.rowId) ?? 0;
    const point = terminalPoint(this.host.axis, bar, side, rowTop);
    const handle = document.createElement('div');
    handle.className = 'jects-scheduler__terminal';
    handle.dataset.side = side;
    handle.dataset.barId = String(bar.event.id);
    handle.style.left = `${point.x}px`;
    handle.style.top = `${point.y}px`;
    // Each terminal is its own pointerdown origin → start the link gesture.
    handle.addEventListener('pointerdown', (e) => this.onTerminalDown(e, bar, side));
    return handle;
  }

  private clearTerminals(): void {
    for (const el of this.terminalEls) el.remove();
    this.terminalEls = [];
  }

  private onBarPointerOver(e: PointerEvent): void {
    if (this.drag) return; // don't churn terminals mid-link
    const barEl = this.barElFrom(e.target);
    if (!barEl) return;
    const id = barEl.dataset.eventId;
    if (id == null) return;
    const resolved = this.resolveBarId(id);
    if (resolved == null) return;
    if (this.hoveredBarId !== resolved) this.showTerminalsFor(resolved);
  }

  private onBarPointerOut(e: PointerEvent): void {
    if (this.drag) return;
    // Only clear when leaving the bar+terminals region entirely.
    const related = e.relatedTarget;
    if (related instanceof HTMLElement) {
      if (related.closest('.jects-scheduler__bar') || related.classList.contains('jects-scheduler__terminal')) {
        return;
      }
    }
    this.hoveredBarId = null;
    this.clearTerminals();
  }

  private barElFrom(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof HTMLElement)) return null;
    return target.closest('.jects-scheduler__bar');
  }

  /** Resolve a raw `data-event-id` string to a bar key (string or number). */
  private resolveBarId(raw: string): RecordId | null {
    if (this.host.visibleBars.has(raw)) return raw;
    const n = Number(raw);
    if (!Number.isNaN(n) && this.host.visibleBars.has(n)) return n;
    return null;
  }

  /* ── drag-to-link gesture ──────────────────────────────────────────────── */

  private onTerminalDown(down: PointerEvent, bar: EventBar<EventModel>, side: DependencyTerminal): void {
    if (down.button !== 0 || this.destroyed) return;
    // Stop the bar's own move/resize gesture from also starting.
    down.preventDefault();
    down.stopPropagation();

    const rubber = document.createElementNS(SVG_NS, 'path');
    rubber.setAttribute('class', 'jects-scheduler__dep-rubber');
    this.host.depsLayer.appendChild(rubber);

    this.drag = { from: { barId: bar.event.id, side, bar }, rubber, target: null };
    this.updateRubber(this.host.toContentX(down.clientX), this.host.toContentY(down.clientY));

    const move = addListener(window, 'pointermove', (e) => this.onLinkMove(e));
    const up = addListener(window, 'pointerup', (e) => this.onLinkUp(e));
    const cancel = addListener(window, 'pointercancel', () => this.cancelLink());
    // Keep these on the disposer bag too, so a destroy mid-gesture cleans them.
    this.disposers.add(move);
    this.disposers.add(up);
    this.disposers.add(cancel);
    this.dragDisposers = [move, up, cancel];

    try {
      (down.target as HTMLElement)?.setPointerCapture?.(down.pointerId);
    } catch {
      /* best-effort (jsdom) */
    }
  }

  private dragDisposers: Array<() => void> = [];

  private onLinkMove(e: PointerEvent): void {
    if (!this.drag) return;
    const cx = this.host.toContentX(e.clientX);
    const cy = this.host.toContentY(e.clientY);
    // Hit-test a candidate target terminal under the pointer.
    const target = this.terminalAt(e);
    this.drag.target = target && target.barId !== this.drag.from.barId ? target : null;
    this.highlightTarget();
    if (this.drag.target) {
      const t = this.drag.target;
      const rowTop = this.host.rowTops.get(t.bar.event.rowId) ?? 0;
      const pt = terminalPoint(this.host.axis, t.bar, t.side, rowTop);
      this.updateRubber(pt.x, pt.y);
    } else {
      this.updateRubber(cx, cy);
    }
  }

  private onLinkUp(e: PointerEvent): void {
    if (!this.drag) return;
    const target = this.drag.target ?? this.terminalAt(e);
    const from = this.drag.from;
    this.finishLinkGesture();
    if (!target || target.barId === from.barId) {
      this.host.announce('Link cancelled.');
      return;
    }
    this.createDependency(from, target);
  }

  private cancelLink(): void {
    if (!this.drag) return;
    this.finishLinkGesture();
  }

  private finishLinkGesture(): void {
    if (this.drag) {
      this.drag.rubber.remove();
      this.drag = null;
    }
    for (const d of this.dragDisposers) d();
    this.dragDisposers = [];
    this.clearTargetHighlight();
  }

  /** Hit-test the pointer against a bar's nearest terminal (start/end). */
  private terminalAt(e: PointerEvent): TerminalRef | null {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const barEl = el instanceof HTMLElement ? el.closest<HTMLElement>('.jects-scheduler__bar') : null;
    if (!barEl) {
      // Maybe directly over a terminal handle.
      if (el instanceof HTMLElement && el.classList.contains('jects-scheduler__terminal')) {
        const id = el.dataset.barId;
        const side = el.dataset.side as DependencyTerminal | undefined;
        if (id != null && side) {
          const resolved = this.resolveBarId(id);
          const bar = resolved == null ? undefined : this.host.visibleBars.get(resolved);
          if (resolved != null && bar) return { barId: resolved, side, bar };
        }
      }
      return null;
    }
    const id = barEl.dataset.eventId;
    if (id == null) return null;
    const resolved = this.resolveBarId(id);
    if (resolved == null) return null;
    const bar = this.host.visibleBars.get(resolved);
    if (!bar || bar.event.editable === false) return null;
    // Choose the nearer terminal by content-x.
    const cx = this.host.toContentX(e.clientX);
    const box = this.host.axis.spanToBox(bar.event.span);
    const distStart = Math.abs(cx - box.x);
    const distEnd = Math.abs(cx - (box.x + box.width));
    const side: DependencyTerminal = distEnd <= distStart ? 'end' : 'start';
    return { barId: resolved, side, bar };
  }

  /** Position the rubber-band line from the source terminal to (x, y). */
  private updateRubber(toX: number, toY: number): void {
    if (!this.drag) return;
    const from = this.drag.from;
    const rowTop = this.host.rowTops.get(from.bar.event.rowId) ?? 0;
    const p = terminalPoint(this.host.axis, from.bar, from.side, rowTop);
    this.drag.rubber.setAttribute('d', `M ${round(p.x)} ${round(p.y)} L ${round(toX)} ${round(toY)}`);
  }

  private highlightTarget(): void {
    this.clearTargetHighlight();
    if (!this.drag?.target) return;
    const t = this.drag.target;
    const sel = `.jects-scheduler__bar[data-event-id="${String(t.barId)}"]`;
    const barEl = this.host.barsLayer.querySelector<HTMLElement>(sel);
    barEl?.classList.add('jects-scheduler__bar--link-target');
  }

  private clearTargetHighlight(): void {
    for (const el of this.host.barsLayer.querySelectorAll('.jects-scheduler__bar--link-target')) {
      el.classList.remove('jects-scheduler__bar--link-target');
    }
  }

  /* ── create / delete ───────────────────────────────────────────────────── */

  /**
   * Infer the type, run guards (self/duplicate/cycle), fire the vetoable
   * `beforeDependencyCreate`, and on success write into the store + emit
   * `dependencyCreate`.
   */
  createDependency(from: TerminalRef, to: TerminalRef): DependencyModel | undefined {
    const type = inferDependencyType(from.side, to.side);
    const fromId = this.masterIdOf(from.barId);
    const toId = this.masterIdOf(to.barId);
    if (fromId === toId) {
      this.host.announce('Cannot link an event to itself.');
      return undefined;
    }
    const store = this.host.dependencyStore;
    if (hasDependency(store, fromId, toId, type)) {
      this.host.announce('That dependency already exists.');
      return undefined;
    }
    if (wouldCreateCycle(store, fromId, toId)) {
      this.host.announce('That link would create a circular dependency.');
      return undefined;
    }
    const candidate: Omit<DependencyModel, 'id'> = { fromId, toId, type };
    if (this.host.emit('beforeDependencyCreate', { dependency: candidate }) === false) {
      this.host.announce('Link creation was cancelled.');
      return undefined;
    }
    const id = `dep-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const record: DependencyModel = { id, fromId, toId, type };
    store.add(record);
    const created = store.getById(id) ?? record;
    this.host.emit('dependencyCreate', { dependency: created });
    this.host.announce(`${type} dependency created.`);
    this.host.repaint();
    return created;
  }

  /**
   * A bar id may be a recurrence-occurrence id (`master::ts`); collapse it to the
   * master event id so dependencies are stored against the real event record.
   */
  private masterIdOf(barId: RecordId): RecordId {
    if (this.host.visibleBars.has(barId)) {
      // Bars carry the master id on the record; prefer that for occurrences.
      const bar = this.host.visibleBars.get(barId);
      const recId = bar?.event.record?.id;
      if (recId != null) return recId;
    }
    return barId;
  }

  /** Select a dependency line by id (visual + delete target). */
  select(id: RecordId | null): void {
    this.selectedId = id;
    for (const path of this.host.depsLayer.querySelectorAll<SVGPathElement>('.jects-scheduler__dep-line')) {
      const match = path.dataset.depId === String(id);
      path.classList.toggle('jects-scheduler__dep-line--selected', match);
    }
  }

  /** The currently-selected dependency id, if any. */
  get selectedDependencyId(): RecordId | null {
    return this.selectedId;
  }

  /** Delete the selected dependency (vetoable), or a specific id. */
  deleteSelected(id: RecordId | null = this.selectedId): boolean {
    if (id == null) return false;
    const store = this.host.dependencyStore;
    const record = store.getById(id);
    if (!record) return false;
    if (this.host.emit('beforeDependencyDelete', { dependency: record }) === false) return false;
    store.remove(id);
    if (this.selectedId === id) this.selectedId = null;
    this.host.emit('dependencyDelete', { dependency: record });
    this.host.announce('Dependency deleted.');
    this.host.repaint();
    return true;
  }

  private onDepClick(e: MouseEvent): void {
    const target = e.target;
    if (!(target instanceof SVGElement)) {
      this.select(null);
      return;
    }
    const path = target.closest<SVGPathElement>('.jects-scheduler__dep-line, .jects-scheduler__dep-hit');
    const id = path?.dataset.depId;
    if (id == null) {
      this.select(null);
      return;
    }
    const resolved = this.host.dependencyStore.getById(id) ? id : this.host.dependencyStore.getById(Number(id)) ? Number(id) : null;
    this.select(resolved);
  }

  private onDepKeyDown(e: KeyboardEvent): void {
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedId != null) {
      this.deleteSelected();
      e.preventDefault();
    } else if (e.key === 'Escape') {
      this.select(null);
    }
  }

  /**
   * Re-apply terminal handles + selection styling after the host repaints (which
   * replaces the bars + SVG children). Called by the host at the end of its paint.
   */
  afterPaint(): void {
    if (this.destroyed) return;
    if (this.hoveredBarId != null && !this.drag) this.showTerminalsFor(this.hoveredBarId);
    if (this.selectedId != null) this.select(this.selectedId);
  }

  /** Release every listener, handle, and the live rubber-band (idempotent). */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.finishLinkGesture();
    this.clearTerminals();
    this.disposers.dispose();
  }
}

/** Round to 0.01px for compact, deterministic SVG path strings. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}
