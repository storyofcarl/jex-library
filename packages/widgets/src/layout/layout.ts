/**
 * Layout — a classic border layout: up to five cell regions
 * (`north`, `south`, `west`, `east`, `center`) where the edge regions are
 * resizable (via nested `Splitter`s) and collapsible, and `center` fills the
 * remaining space.
 *
 * Composition strategy (reuses the sibling `Splitter` widget):
 *   north
 *   ├ (vertical splitter)
 *   middle row:  west │ (center east) │  (horizontal splitters)
 *   ├ (vertical splitter)
 *   south
 *
 * Each present edge region contributes a nested splitter so its size is
 * drag-adjustable and persistable; absent regions are simply not built.
 *
 * Follows the Button reference pattern: extends `Widget<Config, Events>`,
 * supplies `defaults()`, builds the root once in `buildEl()`, syncs DOM in
 * `render()`, emits vetoable `beforeCollapse`/`beforeExpand` then
 * `collapse`/`expand`, and registers with the factory.
 *
 * a11y: the root is `role="group"`; each cell is `role="region"` with an
 * `aria-label` derived from the region name; the nested splitters provide the
 * separators (`role="separator"`) with their own keyboard support.
 */

import {
  Widget,
  type WidgetConfig,
  type WidgetEvents,
  createEl,
  register,
} from '@jects/core';
import { Splitter, type SplitterConfig } from './splitter.js';

export type RegionName = 'north' | 'south' | 'west' | 'east' | 'center';
/** Cell content: a widget, an element, or trusted HTML. */
export type CellContent = Widget | HTMLElement | string;

export interface RegionConfig {
  /** Content for this region. */
  content?: CellContent;
  /** Initial size as a fraction (0–1) of the splitter axis. Default `0.25`. */
  size?: number;
  /** Whether this edge region can be collapsed. Default `true`. */
  collapsible?: boolean;
  /** Initial collapsed state. Default `false`. */
  collapsed?: boolean;
  /** Minimum splitter ratio. */
  min?: number;
  /** Maximum splitter ratio. */
  max?: number;
  /** localStorage key to persist this region's size under. */
  persist?: string;
}

export interface LayoutConfig extends WidgetConfig {
  /** North (top) region. */
  north?: RegionConfig;
  /** South (bottom) region. */
  south?: RegionConfig;
  /** West (left) region. */
  west?: RegionConfig;
  /** East (right) region. */
  east?: RegionConfig;
  /** Center region (always fills remaining space). */
  center?: RegionConfig;
}

export interface LayoutEvents extends WidgetEvents {
  /** Vetoable: return `false` to cancel collapsing a region. */
  beforeCollapse: { region: RegionName; layout: Layout };
  /** Vetoable: return `false` to cancel expanding a region. */
  beforeExpand: { region: RegionName; layout: Layout };
  collapse: { region: RegionName; layout: Layout };
  expand: { region: RegionName; layout: Layout };
  /** A region's splitter ratio changed. */
  resize: { region: RegionName; ratio: number; layout: Layout };
}

const EDGE_REGIONS: readonly RegionName[] = ['north', 'south', 'west', 'east'];

export class Layout extends Widget<LayoutConfig, LayoutEvents> {
  /**
   * Owned child widgets (cell content + nested splitters), destroyed with us.
   * Collapsed state per edge region (live; survives re-render).
   * NOTE: both use `declare` (type-only, emit NO field) — under
   * `useDefineForClassFields`, even an uninitialised field declaration runs
   * `this.x = undefined` AFTER `super()` (which already ran render()), wiping
   * state captured on first render. Initialised in `buildEl()` (runs during
   * super, before any field reset).
   */
  declare private owned: Widget[];
  declare private collapsedState: Partial<Record<RegionName, boolean>>;
  /**
   * Caller-supplied content widgets, keyed by region. These are NOT disposed in
   * `disposeOwned()` (which only tears down internally-created splitters): a
   * re-render (collapse/expand/toggle/update/splitter-resize) must leave a
   * consumer's live Widget mounted in a cell fully functional. They are detached
   * and re-appended across renders, and only destroyed when their region is
   * removed from config or on `destroy()`.
   */
  declare private contentState: Partial<Record<RegionName, Widget>>;

  private get ownedList(): Widget[] {
    return (this.owned ??= []);
  }
  private get collapsed(): Partial<Record<RegionName, boolean>> {
    return (this.collapsedState ??= {});
  }
  private get contentWidgets(): Partial<Record<RegionName, Widget>> {
    return (this.contentState ??= {});
  }

  protected override defaults(): Partial<LayoutConfig> {
    return {};
  }

  protected buildEl(): HTMLElement {
    this.owned = [];
    this.collapsedState = {};
    this.contentState = {};
    return createEl('div', {
      className: 'jects-layout',
      attrs: { role: 'group', 'aria-label': 'Layout' },
    });
  }

  /** Is an edge region currently collapsed? */
  isCollapsed(region: RegionName): boolean {
    return !!this.collapsed[region];
  }

  /** Collapse an edge region (vetoable). */
  collapse(region: RegionName): void {
    if (region === 'center' || !this.regionCollapsible(region)) return;
    if (this.collapsed[region]) return;
    if (this.emit('beforeCollapse', { region, layout: this }) === false) return;
    this.collapsed[region] = true;
    this.render();
    this.emit('collapse', { region, layout: this });
  }

  /** Expand an edge region (vetoable). */
  expand(region: RegionName): void {
    if (region === 'center') return;
    if (!this.collapsed[region]) return;
    if (this.emit('beforeExpand', { region, layout: this }) === false) return;
    this.collapsed[region] = false;
    this.render();
    this.emit('expand', { region, layout: this });
  }

  /** Toggle an edge region's collapsed state. */
  toggle(region: RegionName): void {
    if (this.isCollapsed(region)) this.expand(region);
    else this.collapse(region);
  }

  private regionCollapsible(region: RegionName): boolean {
    return this.config[region]?.collapsible !== false;
  }

  /**
   * Dispose only internally-created widgets (the nested splitters). Caller
   * content widgets live in `contentWidgets` and are deliberately NOT torn down
   * here, so an unchanged region's live content survives a re-render.
   */
  private disposeOwned(): void {
    for (const w of this.ownedList.splice(0)) {
      if (!w.isDestroyed) w.destroy();
    }
  }

  /**
   * Destroy any tracked content widgets whose region no longer supplies that
   * same widget instance (region removed, or its content swapped for something
   * else). Called from render() before cells are rebuilt.
   */
  private reconcileContentWidgets(): void {
    const widgets = this.contentWidgets;
    for (const r of [...EDGE_REGIONS, 'center'] as RegionName[]) {
      const tracked = widgets[r];
      if (!tracked) continue;
      if (this.config[r]?.content !== tracked) {
        if (!tracked.isDestroyed) tracked.destroy();
        delete widgets[r];
      }
    }
  }

  private destroyContentWidgets(): void {
    const widgets = this.contentWidgets;
    for (const r of Object.keys(widgets) as RegionName[]) {
      const w = widgets[r];
      if (w && !w.isDestroyed) w.destroy();
      delete widgets[r];
    }
  }

  /** Create a `role=region` cell element holding the given content. */
  private makeCell(region: RegionName, content: CellContent | undefined): HTMLElement {
    const cell = createEl('div', {
      className: `jects-layout__cell jects-layout__cell--${region}`,
      attrs: { role: 'region', 'aria-label': region },
    });
    if (content instanceof Widget) {
      // Caller-supplied widget: track it per-region so it SURVIVES re-renders.
      // disposeOwned() never touches it; we merely detach (move) its element
      // here. Destroyed only when its region is removed or on Layout.destroy().
      this.contentWidgets[region] = content;
      content.el.remove();
      cell.appendChild(content.el);
    } else if (content instanceof HTMLElement) {
      cell.appendChild(content);
    } else if (typeof content === 'string') {
      cell.innerHTML = content;
    }
    return cell;
  }

  /**
   * Build a Splitter with the given region as the `first` pane and `rest` as
   * the second, wiring resize → layout `resize` event. When `swap` is true the
   * region is placed in `second` instead (used for south/east which sit after
   * the center). Returns the splitter (mounted detached; caller appends `.el`).
   */
  private makeEdgeSplitter(
    region: RegionName,
    orientation: 'horizontal' | 'vertical',
    regionEl: HTMLElement,
    rest: HTMLElement,
    placeFirst: boolean,
    cfg: RegionConfig,
  ): Splitter {
    const size = clamp01(cfg.size ?? 0.25);
    const ratio = placeFirst ? size : 1 - size;
    const spConfig: SplitterConfig = {
      orientation,
      ratio,
      first: placeFirst ? regionEl : rest,
      second: placeFirst ? rest : regionEl,
    };
    if (cfg.min !== undefined) spConfig.min = cfg.min;
    if (cfg.max !== undefined) spConfig.max = cfg.max;
    if (cfg.persist !== undefined) spConfig.persist = cfg.persist;
    const sp = new Splitter(createEl('div'), spConfig);
    sp.on('resize', ({ ratio: r }) => {
      this.emit('resize', { region, ratio: r, layout: this });
    });
    this.ownedList.push(sp);
    return sp;
  }

  protected override render(): void {
    const el = this.el;
    el.className = ['jects-layout', this.config.cls ?? ''].filter(Boolean).join(' ');

    // Initialise collapsed state from config on first render only (preserve
    // live state across subsequent re-renders).
    const collapsed = this.collapsed;
    for (const r of EDGE_REGIONS) {
      if (collapsed[r] === undefined) {
        collapsed[r] = this.config[r]?.collapsed ?? false;
      }
    }

    // Prune content widgets whose region was removed/swapped (destroys them),
    // then tear down internal splitters. Surviving content widgets are detached
    // from the old tree by replaceChildren() and re-appended by makeCell().
    this.reconcileContentWidgets();
    this.disposeOwned();
    el.replaceChildren();

    const has = (r: RegionName): boolean => {
      if (r === 'center') return !!this.config.center;
      return !!this.config[r] && !collapsed[r];
    };

    // Build the center + horizontal (west/east) middle band first.
    const centerCell = this.makeCell('center', this.config.center?.content);

    // Middle row: west │ (center) │ east, composed via nested horizontal splitters.
    let middle: HTMLElement = centerCell;
    if (has('east')) {
      const eastCell = this.makeCell('east', this.config.east!.content);
      const sp = this.makeEdgeSplitter('east', 'horizontal', eastCell, middle, false, this.config.east!);
      middle = sp.el;
    }
    if (has('west')) {
      const westCell = this.makeCell('west', this.config.west!.content);
      const sp = this.makeEdgeSplitter('west', 'horizontal', westCell, middle, true, this.config.west!);
      middle = sp.el;
    }

    // Wrap the middle band so vertical splitters stack north/south around it.
    let body: HTMLElement = middle;
    if (has('south')) {
      const southCell = this.makeCell('south', this.config.south!.content);
      const sp = this.makeEdgeSplitter('south', 'vertical', southCell, body, false, this.config.south!);
      body = sp.el;
    }
    if (has('north')) {
      const northCell = this.makeCell('north', this.config.north!.content);
      const sp = this.makeEdgeSplitter('north', 'vertical', northCell, body, true, this.config.north!);
      body = sp.el;
    }

    el.appendChild(body);
  }

  override destroy(): void {
    if (this.isDestroyed) return;
    this.disposeOwned();
    this.destroyContentWidgets();
    super.destroy();
  }
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

register(
  'layout',
  Layout as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Layout,
);
