/**
 * Tree — hierarchical data view bound to a @jects/core `TreeStore`.
 *
 * Mirrors the Button reference: extends `Widget<Config, Events>`, supplies
 * `defaults()`, builds its root once in `buildEl()`, syncs DOM in `render()`,
 * registers with the factory, and emits vetoable `before*` events.
 *
 * Features: expand/collapse, single/multi selection, optional checkboxes,
 * indentation by depth, full keyboard nav, and lazy children via the store's
 * `loadChildren` / `loader`.
 */

import {
  Widget,
  type WidgetConfig,
  type WidgetEvents,
  createEl,
  register,
  TreeStore,
  type TreeNode,
  type RecordId,
} from '@jects/core';

export type TreeSelectionMode = 'single' | 'multi' | 'none';

export interface TreeConfig<T extends TreeNode = TreeNode> extends WidgetConfig {
  /** Bound store. If omitted, one is created from `data`. */
  store?: TreeStore<T>;
  /** Inline data (used to build a store when `store` is not supplied). */
  data?: T[];
  /** Field rendered as the node label. Default `'text'`. */
  labelField?: string;
  /** Selection behaviour. Default `'single'`. */
  selectionMode?: TreeSelectionMode;
  /** Show a checkbox before each node. Default `false`. */
  checkboxes?: boolean;
  /** Indentation per depth level in px. Default `16`. */
  indent?: number;
  /** Lazy loader for node children (forwarded to a freshly created store). */
  loadChildren?: (node: T) => Promise<T[]>;
  /** Accessible name for the tree (`aria-label`). Default `'Tree'`. */
  label?: string;
}

export interface TreeEvents<T extends TreeNode = TreeNode> extends WidgetEvents {
  /** Vetoable: return `false` to cancel selection. */
  beforeSelect: { node: T; id: RecordId; tree: Tree<T> };
  select: { node: T; id: RecordId; selected: RecordId[]; tree: Tree<T> };
  /** Vetoable: return `false` to cancel expansion/collapse. */
  beforeToggle: { node: T; id: RecordId; expanded: boolean; tree: Tree<T> };
  toggle: { node: T; id: RecordId; expanded: boolean; tree: Tree<T> };
  check: { node: T; id: RecordId; checked: RecordId[]; tree: Tree<T> };
  /** Recoverable error, e.g. a lazy `loadChildren` loader rejected. */
  error: { node: T; id: RecordId; err: unknown; tree: Tree<T> };
}

export class Tree<T extends TreeNode = TreeNode> extends Widget<TreeConfig<T>, TreeEvents<T>> {
  // `declare` so no field initializer is emitted (with useDefineForClassFields a
  // plain `field!` would be re-assigned `undefined` AFTER super() ran render()).
  private declare store: TreeStore<T>;
  private declare selected: Set<RecordId>;
  private declare checked: Set<RecordId>;
  // `declare` (no field initializer) so the value set during the first render
  // — which runs inside super() — is NOT clobbered back to `null` by a field
  // initializer running AFTER super() (useDefineForClassFields). Initialized in
  // initStore() so the first visible node gets tabindex=0 from first paint.
  private declare activeId: RecordId | null;

  protected override defaults(): Partial<TreeConfig<T>> {
    return {
      labelField: 'text',
      selectionMode: 'single',
      checkboxes: false,
      indent: 16,
      label: 'Tree',
    };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', { className: 'jects-tree' });
    root.setAttribute('role', 'tree');
    root.tabIndex = 0;
    root.addEventListener('click', (e) => this.handleClick(e as MouseEvent));
    root.addEventListener('keydown', (e) => this.handleKeydown(e as KeyboardEvent));
    return root;
  }

  protected override render(): void {
    if (!this.store) this.initStore();
    const { indent = 16, checkboxes = false, labelField = 'text' } = this.config;
    const visible = this.store.getVisible();

    if (this.activeId === null && visible.length) {
      this.activeId = this.idOf(visible[0]!.node);
    }

    const rows = visible.map(({ node, depth }) => {
      const id = this.idOf(node);
      const isLeaf = this.store.isLeaf(node);
      const expanded = this.store.isExpanded(node);
      const isSelected = this.selected.has(id);
      const isChecked = this.checked.has(id);
      const isActive = this.activeId === id;
      const label = String((node as Record<string, unknown>)[labelField] ?? '');

      const twisty = isLeaf
        ? `<span class="jects-tree__twisty jects-tree__twisty--leaf" aria-hidden="true"></span>`
        : `<button type="button" class="jects-tree__twisty" tabindex="-1" aria-label="${expanded ? 'Collapse' : 'Expand'}" data-twisty="${escapeAttr(String(id))}">${expanded ? '▾' : '▸'}</button>`;

      const checkbox = checkboxes
        ? `<span class="jects-tree__checkbox${isChecked ? ' jects-tree__checkbox--checked' : ''}" role="checkbox" aria-checked="${isChecked}" aria-label="${escapeAttr(label)}" data-check="${escapeAttr(String(id))}" aria-hidden="false">${isChecked ? '✓' : ''}</span>`
        : '';

      return [
        `<div class="jects-tree__node${isSelected ? ' jects-tree__node--selected' : ''}${isActive ? ' jects-tree__node--active' : ''}"`,
        ` role="treeitem"`,
        ` data-id="${escapeAttr(String(id))}"`,
        ` aria-level="${depth + 1}"`,
        ` aria-selected="${isSelected}"`,
        isLeaf ? '' : ` aria-expanded="${expanded}"`,
        ` tabindex="${isActive ? 0 : -1}"`,
        ` style="padding-inline-start: ${depth * indent}px;">`,
        twisty,
        checkbox,
        `<span class="jects-tree__label">${escapeHtml(label)}</span>`,
        `</div>`,
      ].join('');
    });

    this.el.className = ['jects-tree', this.config.cls ?? ''].filter(Boolean).join(' ');
    this.el.setAttribute('aria-multiselectable', String(this.config.selectionMode === 'multi'));
    this.el.setAttribute('aria-label', this.config.label ?? 'Tree');
    this.el.innerHTML = rows.join('');
  }

  // ---- store wiring -------------------------------------------------------

  private initStore(): void {
    this.activeId = null;
    this.selected = new Set<RecordId>();
    this.checked = new Set<RecordId>();
    if (this.config.store) {
      this.store = this.config.store;
    } else {
      this.store = new TreeStore<T>({
        data: this.config.data ?? [],
        ...(this.config.loadChildren ? { loader: this.config.loadChildren } : {}),
      });
    }
    const off = this.store.events.on('change', () => this.render());
    this.track(off);
  }

  private idOf(node: T): RecordId {
    return (node as Record<string, unknown>)[this.store.idField] as RecordId;
  }

  /** The bound store (creating one lazily if needed). */
  getStore(): TreeStore<T> {
    if (!this.store) this.initStore();
    return this.store;
  }

  /** Currently selected ids. */
  getSelected(): RecordId[] {
    return [...this.selected];
  }

  /** Currently checked ids (checkbox mode). */
  getChecked(): RecordId[] {
    return [...this.checked];
  }

  // ---- interaction --------------------------------------------------------

  private handleClick(event: MouseEvent): void {
    if (!this.store) this.initStore();
    const target = event.target as HTMLElement;
    const twisty = target.closest<HTMLElement>('[data-twisty]');
    if (twisty) {
      void this.toggleNode(twisty.dataset['twisty'] ?? '');
      return;
    }
    const check = target.closest<HTMLElement>('[data-check]');
    if (check) {
      this.toggleCheck(coerceId(check.dataset['check'] ?? '', this.store));
      return;
    }
    const node = target.closest<HTMLElement>('.jects-tree__node');
    if (node) {
      const id = coerceId(node.dataset['id'] ?? '', this.store);
      this.activeId = id;
      this.selectNode(id);
    }
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (!this.store) this.initStore();
    const visible = this.store.getVisible();
    if (!visible.length) return;
    const ids = visible.map((v) => this.idOf(v.node));
    let idx = this.activeId === null ? 0 : ids.indexOf(this.activeId);
    if (idx < 0) idx = 0;
    const current = visible[idx]!;
    const currentId = this.idOf(current.node);

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.setActive(ids[Math.min(idx + 1, ids.length - 1)]!);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.setActive(ids[Math.max(idx - 1, 0)]!);
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (!this.store.isLeaf(current.node) && !this.store.isExpanded(current.node)) {
          void this.toggleNode(String(currentId));
        } else if (idx + 1 < ids.length) {
          this.setActive(ids[idx + 1]!);
        }
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (!this.store.isLeaf(current.node) && this.store.isExpanded(current.node)) {
          void this.toggleNode(String(currentId));
        }
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (this.config.checkboxes) this.toggleCheck(currentId);
        else this.selectNode(currentId);
        break;
      case 'Home':
        event.preventDefault();
        this.setActive(ids[0]!);
        break;
      case 'End':
        event.preventDefault();
        this.setActive(ids[ids.length - 1]!);
        break;
      default:
        break;
    }
  }

  private setActive(id: RecordId): void {
    this.activeId = id;
    this.render();
    const node = this.el.querySelector<HTMLElement>(`.jects-tree__node[data-id="${cssEscape(String(id))}"]`);
    node?.focus();
  }

  private async toggleNode(rawId: string): Promise<void> {
    const id = coerceId(rawId, this.store);
    const node = this.store.getById(id);
    if (!node) return;
    const willExpand = !this.store.isExpanded(node);
    if (this.emit('beforeToggle', { node, id, expanded: willExpand, tree: this }) === false) return;
    if (!willExpand) {
      // Collapse is always synchronous.
      this.store.collapse(node);
      this.emit('toggle', { node, id, expanded: false, tree: this });
      return;
    }
    const needsLoad =
      !!this.config.loadChildren && this.store.getChildren(node).length === 0;
    if (needsLoad) {
      // Lazy children: expansion completes after the loader resolves. The loader
      // is user-supplied and may reject; never leave the promise unhandled (the
      // caller invokes us fire-and-forget). On failure, revert the half-expanded
      // state and surface a recoverable `error` event instead of throwing.
      try {
        await this.store.expand(node);
      } catch (err) {
        // `TreeStore.expand` marks the node expanded BEFORE awaiting the loader,
        // so collapse to undo the half-expanded state (this also re-renders).
        if (!this.isDestroyed) this.store.collapse(node);
        if (this.isDestroyed) return;
        this.emit('error', { node, id, err, tree: this });
        return;
      }
      // The widget may have been destroyed (or the node removed) while the
      // loader was in flight: do not emit on a torn-down emitter or read a
      // stale store / render into a removed element.
      if (this.isDestroyed) return;
      if (!this.store.getById(id)) return;
      this.emit('toggle', { node, id, expanded: this.store.isExpanded(node), tree: this });
      return;
    }
    // Children already present (or no loader): expand synchronously so the
    // `toggle` event and re-render happen in the same tick. No loader runs on
    // this path, but guard the returned promise so a stray rejection can never
    // become an unhandled rejection.
    void this.store.expand(node).catch((err: unknown) => {
      if (this.isDestroyed) return;
      this.emit('error', { node, id, err, tree: this });
    });
    this.emit('toggle', { node, id, expanded: this.store.isExpanded(node), tree: this });
  }

  private selectNode(id: RecordId): void {
    const mode = this.config.selectionMode ?? 'single';
    if (mode === 'none') return;
    const node = this.store.getById(id);
    if (!node) return;
    if (this.emit('beforeSelect', { node, id, tree: this }) === false) return;
    if (mode === 'single') {
      this.selected.clear();
      this.selected.add(id);
    } else {
      if (this.selected.has(id)) this.selected.delete(id);
      else this.selected.add(id);
    }
    this.render();
    this.emit('select', { node, id, selected: [...this.selected], tree: this });
  }

  private toggleCheck(id: RecordId): void {
    const node = this.store.getById(id);
    if (!node) return;
    if (this.checked.has(id)) this.checked.delete(id);
    else this.checked.add(id);
    this.render();
    this.emit('check', { node, id, checked: [...this.checked], tree: this });
  }
}

function coerceId<T extends TreeNode>(raw: string, store: TreeStore<T>): RecordId {
  // Prefer the existing record's id type; fall back to string.
  if (store.getById(raw)) return raw;
  const n = Number(raw);
  if (!Number.isNaN(n) && store.getById(n)) return n;
  return raw;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
function cssEscape(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

register(
  'tree',
  Tree as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Tree,
);
