/**
 * `ProjectLines` — configurable named vertical marker lines drawn across the
 * Gantt timeline at arbitrary dates, plus the `GanttPrintController` print path.
 *
 * This is the Bryntum/DHTMLX "ProjectLines" feature: where the base timeline
 * renders a single hard-coded `today` line, a project plan needs an open-ended
 * set of named markers — the project start and finish, contractual deadlines,
 * release gates, custom milestones — each at its own date, drawn full-height
 * across the time grid with a readable label and a styleable colour/kind.
 *
 * Design (mirrors the rest of the package's contract-first layering):
 *   - It is a PURE renderer + projector over a framework-free `TimeAxis` (the
 *     same projection primitive the timeline view already composes). It owns one
 *     light-DOM layer element and paints one line + label per resolved marker.
 *     It never schedules, never mutates tasks, and never reaches past the axis.
 *   - Markers are declared as plain `ProjectLine` config. Date anchors may be an
 *     absolute epoch-ms `date`, or a symbolic `'projectStart'` / `'projectEnd'`
 *     keyword resolved against the supplied project span — so a consumer can pin
 *     a line to the live project boundary without recomputing it on every edit.
 *   - Interactions surface through a typed callback (`onLineClick`) so the owning
 *     widget can route a click (e.g. open a deadline editor) without this module
 *     depending on the Gantt API.
 *
 * The print path lives here too because it is the natural companion feature
 * ("print the export-rendered Gantt"): `GanttPrintController` injects a scoped
 * print stylesheet and drives `window.print()` over a chosen root, restoring the
 * document afterwards. It is DOM-only and leak-safe (every listener/disposer is
 * tracked and released on `destroy()`).
 *
 * All times are epoch milliseconds (UTC), consistent with the rest of @jects/gantt.
 */

import { createEl } from '@jects/core';
import type { TimeAxis, TimeMs, TimeSpan } from '@jects/timeline-core';

/* ═══════════════════════════════════════════════════════════════════════════
   1. PROJECT-LINE MODEL
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Kind of project line → CSS modifier key. Drives the marker's colour/weight.
 * `'deadline'` reuses the warning token, `'start'`/`'end'` the project accents,
 * `'today'` the now-marker colour, `'milestone'`/`'custom'` a neutral accent.
 */
export type ProjectLineKind =
  | 'start'
  | 'end'
  | 'deadline'
  | 'milestone'
  | 'today'
  | 'custom';

/**
 * A symbolic date anchor resolved against the live project span, so a line can
 * track the project boundary without the consumer recomputing it on each edit.
 */
export type ProjectLineAnchor = 'projectStart' | 'projectEnd';

/** Where the marker's label sits relative to the line. Default `'top'`. */
export type ProjectLineLabelSide = 'top' | 'bottom';

/**
 * A single configurable vertical marker line. Exactly one of `date` (absolute
 * epoch ms) or `anchor` (symbolic project boundary) positions it; if both are
 * given, `date` wins.
 */
export interface ProjectLine {
  /** Stable id (used as the React-ish key and for click routing). */
  id: string;
  /** Absolute position in epoch ms. */
  date?: TimeMs;
  /** Symbolic position resolved against the project span. */
  anchor?: ProjectLineAnchor;
  /** Display label (rendered next to the line; also the accessible name). */
  label?: string;
  /** Kind → CSS modifier (colour/weight). Default `'custom'`. */
  kind?: ProjectLineKind;
  /** Which side the label sits on. Default `'top'`. */
  labelSide?: ProjectLineLabelSide;
  /** Extra CSS class to attach to the line element. */
  cls?: string;
}

/** A project line resolved to a concrete date (symbolic anchors expanded). */
export interface ResolvedProjectLine extends ProjectLine {
  /** The concrete epoch-ms position the line resolved to. */
  date: TimeMs;
}

/** A resolved project line projected to a pixel x, ready to paint. */
export interface ProjectLineBox {
  /** The resolved source line. */
  line: ResolvedProjectLine;
  /** Left px within the axis content. */
  x: number;
}

/**
 * Resolve symbolic anchors (`projectStart`/`projectEnd`) to concrete dates and
 * drop any line that has neither a `date` nor a resolvable `anchor`. Pure.
 *
 * @param lines  The configured project lines.
 * @param span   The current project span the anchors resolve against.
 */
export function resolveProjectLines(
  lines: ReadonlyArray<ProjectLine>,
  span: TimeSpan | undefined,
): ResolvedProjectLine[] {
  const out: ResolvedProjectLine[] = [];
  for (const line of lines) {
    let date: TimeMs | undefined = line.date;
    if (date == null && line.anchor != null && span != null) {
      date = line.anchor === 'projectStart' ? span.start : span.end;
    }
    if (date == null || !Number.isFinite(date)) continue;
    out.push({ ...line, date });
  }
  return out;
}

/**
 * Project resolved project lines to pixel boxes against the axis. Lines whose
 * date falls outside the axis range are dropped (markers are zero-width, so we
 * use an inclusive bound on both ends). Pure projection — no DOM.
 */
export function projectProjectLines(
  lines: ReadonlyArray<ResolvedProjectLine>,
  axis: TimeAxis,
): ProjectLineBox[] {
  const { start, end } = axis.range;
  const out: ProjectLineBox[] = [];
  for (const line of lines) {
    if (line.date < start || line.date > end) continue;
    out.push({ line, x: axis.toX(line.date) });
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. PROJECT-LINES RENDERER
   ═══════════════════════════════════════════════════════════════════════════ */

/** Construction options for the {@link ProjectLines} renderer. */
export interface ProjectLinesOptions {
  /** The time axis the lines are projected against. */
  axis: TimeAxis;
  /** Initial line set. */
  lines?: ProjectLine[];
  /** Project span symbolic anchors resolve against. */
  projectSpan?: TimeSpan;
  /**
   * Click routing for a marker line/label (e.g. open a deadline editor). Fired
   * for both a pointer click and a keyboard activation (Enter/Space) of an
   * interactive marker, so `native` may be a `MouseEvent` or `KeyboardEvent`.
   */
  onLineClick?(id: string, native: MouseEvent | KeyboardEvent): void;
}

/**
 * Renders the configured project lines into one owned light-DOM layer. The owner
 * positions the layer (it is `position:absolute; inset:0` by CSS); this class
 * only paints/repaints the lines and reports clicks.
 *
 * Lifecycle: `new ProjectLines(opts)` → append `el` into the timeline content →
 * `setLines` / `setProjectSpan` / `setHeight` / `refresh` to repaint →
 * `destroy()` to release the listener and remove the element.
 */
export class ProjectLines {
  /** The owned layer element (caller appends it into the timeline content). */
  readonly el: HTMLElement;

  private readonly axis: TimeAxis;
  private readonly onLineClick: ProjectLinesOptions['onLineClick'];
  private lines: ProjectLine[];
  private projectSpan: TimeSpan | undefined;
  private height = 0;
  private destroyed = false;
  private readonly disposers: Array<() => void> = [];

  constructor(opts: ProjectLinesOptions) {
    this.axis = opts.axis;
    this.lines = opts.lines ? [...opts.lines] : [];
    this.projectSpan = opts.projectSpan;
    this.onLineClick = opts.onLineClick;

    this.el = createEl('div', { className: 'jects-gantt__project-lines' });
    // The layer is a backdrop of markers; it must not eat pointer events meant
    // for the bars beneath it. Individual interactive markers opt back into
    // pointer events (see CSS + click delegation below).
    //
    // Container role depends on the markers' role: a `list` may only contain
    // `listitem` children (aria-required-children), but interactive markers are
    // `button`s — so an interactive layer is a labelled `group` of buttons while
    // a presentational layer stays a `list` of listitems.
    this.el.setAttribute('role', this.onLineClick != null ? 'group' : 'list');
    this.el.setAttribute('aria-label', 'Project lines');

    const onClick = (e: MouseEvent): void => this.handleClick(e);
    this.el.addEventListener('click', onClick);
    this.disposers.push(() => this.el.removeEventListener('click', onClick));

    // Keyboard activation for interactive markers (Enter/Space), mirroring the
    // indicators feature, so a keyboard/AT user can operate a focusable line.
    // Delegated on the layer; only fires when an interactive line is focused.
    if (this.onLineClick != null) {
      const onKey = (e: KeyboardEvent): void => this.handleKeydown(e);
      this.el.addEventListener('keydown', onKey);
      this.disposers.push(() => this.el.removeEventListener('keydown', onKey));
    }

    // Paint the initial line set so the layer is populated as soon as it is
    // appended, without requiring a setter call first.
    this.refresh();
  }

  /** Replace the configured lines and repaint. */
  setLines(lines: ProjectLine[]): void {
    this.lines = [...lines];
    this.refresh();
  }

  /** Update the project span symbolic anchors resolve against, and repaint. */
  setProjectSpan(span: TimeSpan | undefined): void {
    this.projectSpan = span;
    this.refresh();
  }

  /** Set the full content height (so lines span the whole scroll content). */
  setHeight(height: number): void {
    this.height = Math.max(0, height);
    this.refresh();
  }

  /** The resolved + visible lines for the current axis/span (for callers/tests). */
  getVisibleLines(): ProjectLineBox[] {
    return projectProjectLines(
      resolveProjectLines(this.lines, this.projectSpan),
      this.axis,
    );
  }

  /** Repaint every line for the current axis projection. Idempotent. */
  refresh(): void {
    if (this.destroyed) return;
    this.el.replaceChildren();
    if (this.height > 0) this.el.style.height = `${this.height}px`;

    for (const box of this.getVisibleLines()) {
      this.el.append(this.buildLineEl(box));
    }
  }

  private buildLineEl(box: ProjectLineBox): HTMLElement {
    const { line } = box;
    const kind = line.kind ?? 'custom';
    const interactive = this.onLineClick != null;
    const lineEl = createEl('div', {
      className:
        `jects-gantt__project-line jects-gantt__project-line--${kind}` +
        (interactive ? ' jects-gantt__project-line--interactive' : '') +
        (line.cls ? ` ${line.cls}` : ''),
    });
    lineEl.style.left = `${box.x}px`;
    lineEl.dataset.lineId = line.id;

    const name = line.label ?? this.defaultLabel(line);
    if (interactive) {
      // An interactive marker is an actionable control: expose it to AT as a
      // focusable button (WCAG 2.1.1 keyboard / 4.1.2 name-role-value) rather
      // than a static list item, so it can be focused and activated by keyboard.
      lineEl.setAttribute('role', 'button');
      lineEl.tabIndex = 0;
    } else {
      // Non-interactive lines stay presentational list items.
      lineEl.setAttribute('role', 'listitem');
    }

    // The line is a vertical rule; the accessible name lives on the rule itself
    // so AT users hear the marker even though the visible label is a child.
    lineEl.setAttribute('aria-label', `${name} marker`);

    if (line.label != null && line.label !== '') {
      const label = createEl('span', {
        className: `jects-gantt__project-line-label jects-gantt__project-line-label--${
          line.labelSide ?? 'top'
        }`,
      });
      label.textContent = line.label;
      lineEl.append(label);
    }

    return lineEl;
  }

  private defaultLabel(line: ProjectLine): string {
    switch (line.kind) {
      case 'start':
        return 'Project start';
      case 'end':
        return 'Project finish';
      case 'deadline':
        return 'Deadline';
      case 'today':
        return 'Today';
      case 'milestone':
        return 'Milestone';
      default:
        return line.id;
    }
  }

  private handleClick(e: MouseEvent): void {
    if (this.onLineClick == null) return;
    const lineEl = (e.target as HTMLElement | null)?.closest?.(
      '.jects-gantt__project-line',
    ) as HTMLElement | null;
    const id = lineEl?.dataset.lineId;
    if (id == null) return;
    this.onLineClick(id, e);
  }

  /**
   * Keyboard activation for a focused interactive marker. Enter or Space routes
   * to the same `onLineClick` handler as a pointer click (the native event is
   * forwarded so callers get a consistent payload shape).
   */
  private handleKeydown(e: KeyboardEvent): void {
    if (this.onLineClick == null) return;
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const lineEl = (e.target as HTMLElement | null)?.closest?.(
      '.jects-gantt__project-line--interactive',
    ) as HTMLElement | null;
    const id = lineEl?.dataset.lineId;
    if (id == null) return;
    // Prevent Space from scrolling and Enter from any default; then activate.
    e.preventDefault();
    this.onLineClick(id, e);
  }

  /** Release the click listener and remove the layer element. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const d of this.disposers.splice(0)) d();
    this.el.remove();
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. PRINT PATH
   ═══════════════════════════════════════════════════════════════════════════ */

/** Options for {@link GanttPrintController.print}. */
export interface GanttPrintOptions {
  /**
   * The element to print (defaults to the controller's root). Only this subtree
   * is shown during printing; the rest of the document is hidden by the injected
   * print stylesheet.
   */
  target?: HTMLElement;
  /** Document title to set on the printout (restored afterwards). */
  title?: string;
  /** Page orientation hint emitted as an `@page` rule. Default `'landscape'`. */
  orientation?: 'portrait' | 'landscape';
  /**
   * Skip the actual `window.print()` call (used by tests / headless export so the
   * stylesheet wiring can be asserted without a print dialog). Default `false`.
   */
  skipDialog?: boolean;
}

/** A unique attribute marking the active print target subtree. */
const PRINT_ROOT_ATTR = 'data-jects-print-root';
const PRINT_STYLE_ID = 'jects-gantt-print-style';

/**
 * Drives the Gantt print path: injects a scoped `@media print` stylesheet that
 * isolates the chosen Gantt subtree (hiding the rest of the page and expanding
 * the Gantt so the full, export-rendered chart prints rather than just the
 * on-screen viewport), calls `window.print()`, then restores the document.
 *
 * It is intentionally decoupled from the `Gantt` widget: it takes a root element
 * so it can be installed as a feature/mixin without touching the widget class.
 * Leak-safe — `destroy()` removes any injected style and clears markers.
 */
export class GanttPrintController {
  private readonly root: HTMLElement;
  private readonly doc: Document;
  private styleEl: HTMLStyleElement | null = null;
  private afterPrint: (() => void) | null = null;
  private destroyed = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.doc = root.ownerDocument ?? document;
  }

  /**
   * Print the Gantt (or a chosen target). Synchronously injects the print
   * stylesheet + marks the target, invokes `window.print()` (unless skipped),
   * and tears the print scaffolding down once the print finishes (via the
   * `afterprint` event, with a microtask fallback for `skipDialog`).
   */
  print(opts: GanttPrintOptions = {}): void {
    if (this.destroyed) return;
    const target = opts.target ?? this.root;
    const orientation = opts.orientation ?? 'landscape';

    // Mark the printable subtree so the stylesheet can isolate it.
    target.setAttribute(PRINT_ROOT_ATTR, '');

    // Optionally swap the document title for the printout.
    const prevTitle = this.doc.title;
    if (opts.title != null) this.doc.title = opts.title;

    this.injectStyle(orientation);

    const restore = (): void => {
      target.removeAttribute(PRINT_ROOT_ATTR);
      this.removeStyle();
      if (opts.title != null) this.doc.title = prevTitle;
      if (this.afterPrint) {
        this.getWindow()?.removeEventListener('afterprint', this.afterPrint);
        this.afterPrint = null;
      }
    };

    const win = this.getWindow();
    if (opts.skipDialog || !win || typeof win.print !== 'function') {
      // Headless/test path: leave the scaffolding in place for one microtask so
      // a caller can assert the injected stylesheet, then restore.
      void Promise.resolve().then(restore);
      return;
    }

    this.afterPrint = restore;
    win.addEventListener('afterprint', restore, { once: true });
    win.print();
  }

  /** True while a print stylesheet is currently injected (mainly for tests). */
  get isPrinting(): boolean {
    return this.styleEl != null;
  }

  private getWindow(): (Window & typeof globalThis) | null {
    return (this.doc.defaultView as (Window & typeof globalThis) | null) ?? null;
  }

  private injectStyle(orientation: 'portrait' | 'landscape'): void {
    this.removeStyle();
    const style = this.doc.createElement('style');
    style.id = PRINT_STYLE_ID;
    style.media = 'print';
    // Token-pure: this print sheet carries no colours — only structural layout
    // (visibility/sizing) so the themed component CSS keeps owning all colour.
    style.textContent = [
      `@page { size: ${orientation}; margin: 12mm; }`,
      '@media print {',
      // Hide everything, then reveal only the marked print-root subtree.
      `  body * { visibility: hidden !important; }`,
      `  [${PRINT_ROOT_ATTR}], [${PRINT_ROOT_ATTR}] * { visibility: visible !important; }`,
      // Float the print-root to the top-left of the page box and let it grow to
      // the full chart size (so the whole Gantt prints, not just the viewport).
      `  [${PRINT_ROOT_ATTR}] {`,
      '    position: absolute !important;',
      '    inset-block-start: 0 !important;',
      '    inset-inline-start: 0 !important;',
      '    inline-size: auto !important;',
      '    block-size: auto !important;',
      '    overflow: visible !important;',
      '  }',
      // Expand inner scrollers so clipped content is not cut off on paper.
      `  [${PRINT_ROOT_ATTR}] .jects-gantt__timeline-scroller,`,
      `  [${PRINT_ROOT_ATTR}] .jects-gantt__tree-scroller {`,
      '    overflow: visible !important;',
      '    block-size: auto !important;',
      '  }',
      '}',
    ].join('\n');
    (this.doc.head ?? this.doc.documentElement).append(style);
    this.styleEl = style;
  }

  private removeStyle(): void {
    this.styleEl?.remove();
    this.styleEl = null;
    // Also clear any stale sheet from a prior controller instance.
    this.doc.getElementById(PRINT_STYLE_ID)?.remove();
  }

  /** Remove any injected print style + markers. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.afterPrint) {
      this.getWindow()?.removeEventListener('afterprint', this.afterPrint);
      this.afterPrint = null;
    }
    this.removeStyle();
    this.doc
      .querySelectorAll(`[${PRINT_ROOT_ATTR}]`)
      .forEach((el) => el.removeAttribute(PRINT_ROOT_ATTR));
  }
}
