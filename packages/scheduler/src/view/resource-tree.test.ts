import { describe, it, expect, beforeEach } from 'vitest';
import { ResourceTree, resourceTree } from './resource-tree.js';
import type { ResourceModel, ResourceColumnConfig } from '../contract.js';

const FLAT: ResourceModel[] = [
  { id: 'team-a', name: 'Team A' },
  { id: 'alice', name: 'Alice', parentId: 'team-a' },
  { id: 'bob', name: 'Bob', parentId: 'team-a' },
  { id: 'team-b', name: 'Team B' },
  { id: 'carol', name: 'Carol', parentId: 'team-b' },
];

const NAME_COL: ResourceColumnConfig = { field: 'name', text: 'Resource' };

describe('ResourceTree — flattened view & RowProvider facade', () => {
  let tree: ResourceTree;
  beforeEach(() => {
    tree = new ResourceTree(FLAT);
  });

  it('flattens the visible hierarchy in display order with depths', () => {
    const rows = tree.getViewRows();
    expect(rows.map((r) => [r.id, r.depth])).toEqual([
      ['team-a', 0],
      ['alice', 1],
      ['bob', 1],
      ['team-b', 0],
      ['carol', 1],
    ]);
  });

  it('marks non-leaf parents as groups, leaves as leaves', () => {
    const rows = tree.getViewRows();
    const teamA = rows.find((r) => r.id === 'team-a')!;
    const alice = rows.find((r) => r.id === 'alice')!;
    expect(teamA.isGroup).toBe(true);
    expect(teamA.leaf).toBe(false);
    expect(alice.isGroup).toBe(false);
    expect(alice.leaf).toBe(true);
  });

  it('count / indexOf / rowAt match the visible view', () => {
    expect(tree.count()).toBe(5);
    expect(tree.indexOf('bob')).toBe(2);
    expect(tree.indexOf('missing')).toBe(-1);
    const row = tree.rowAt(2, 48);
    expect(row?.id).toBe('bob');
    expect(row?.height).toBe(48);
    expect(row?.depth).toBe(1);
    expect(tree.rowAt(99, 48)).toBeUndefined();
  });

  it('honors a per-resource rowHeight in rowAt', () => {
    const t = new ResourceTree([{ id: 'r', name: 'R', rowHeight: 70 }]);
    expect(t.rowAt(0, 48)?.height).toBe(70);
  });
});

describe('ResourceTree — expand / collapse', () => {
  it('collapsing a parent hides its children from the view', async () => {
    const tree = new ResourceTree(FLAT);
    await tree.toggle('team-a');
    expect(tree.isExpanded('team-a')).toBe(false);
    expect(tree.getViewRows().map((r) => r.id)).toEqual([
      'team-a', 'team-b', 'carol',
    ]);
  });

  it('expanding a collapsed parent restores its children', async () => {
    const tree = new ResourceTree(FLAT, { expanded: ['team-b'] });
    expect(tree.getViewRows().map((r) => r.id)).toEqual([
      'team-a', 'team-b', 'carol',
    ]);
    await tree.expand('team-a');
    expect(tree.getViewRows().map((r) => r.id)).toEqual([
      'team-a', 'alice', 'bob', 'team-b', 'carol',
    ]);
  });

  it('emits resourceToggle on toggle with the new state', async () => {
    const tree = new ResourceTree(FLAT);
    const seen: Array<{ id: unknown; expanded: boolean }> = [];
    tree.events.on('resourceToggle', (p) => seen.push({ id: p.id, expanded: p.expanded }));
    await tree.toggle('team-a'); // collapse
    await tree.toggle('team-a'); // expand
    expect(seen).toEqual([
      { id: 'team-a', expanded: false },
      { id: 'team-a', expanded: true },
    ]);
  });

  it('collapseAll then expandAll round-trips the view', async () => {
    const tree = new ResourceTree(FLAT);
    tree.collapseAll();
    expect(tree.getViewRows().map((r) => r.id)).toEqual(['team-a', 'team-b']);
    await tree.expandAll();
    expect(tree.getViewRows().map((r) => r.id)).toEqual([
      'team-a', 'alice', 'bob', 'team-b', 'carol',
    ]);
  });
});

describe('ResourceTree — event aggregation onto collapsed parents', () => {
  it('a collapsed parent owns its hidden descendants ids', async () => {
    const tree = new ResourceTree(FLAT);
    // Expanded: each row owns only itself.
    expect(tree.resourceIdsForRow('team-a')).toEqual(['team-a']);
    await tree.collapse('team-a');
    // Collapsed: parent rolls up alice + bob.
    expect(tree.resourceIdsForRow('team-a').sort()).toEqual(['alice', 'bob', 'team-a']);
  });

  it('aggregates nested grandchildren when a top parent is collapsed', async () => {
    const tree = new ResourceTree([
      { id: 'root', name: 'Root' },
      { id: 'mid', name: 'Mid', parentId: 'root' },
      { id: 'leaf', name: 'Leaf', parentId: 'mid' },
    ]);
    await tree.collapse('root');
    expect(tree.resourceIdsForRow('root').sort()).toEqual(['leaf', 'mid', 'root']);
  });

  it('does not aggregate when aggregate:false', async () => {
    const tree = new ResourceTree(FLAT, { aggregate: false });
    await tree.collapse('team-a');
    expect(tree.resourceIdsForRow('team-a')).toEqual(['team-a']);
  });

  it('leaf rows own only themselves', () => {
    const tree = new ResourceTree(FLAT);
    expect(tree.resourceIdsForRow('alice')).toEqual(['alice']);
  });
});

describe('ResourceTree — locked-column markup', () => {
  it('renders an indentation spacer scaled by depth', () => {
    const tree = new ResourceTree(FLAT, { indent: 20 });
    const aliceView = tree.getViewRows().find((r) => r.id === 'alice')!;
    const html = tree.renderTreeCell(aliceView, NAME_COL);
    expect(html).toContain('padding-inline-start:20px');
    expect(html).toContain('Alice');
    expect(tree.indentFor(2)).toBe(40);
  });

  it('renders a chevron toggle for non-leaf rows with aria-expanded', () => {
    const tree = new ResourceTree(FLAT);
    const teamView = tree.getViewRows().find((r) => r.id === 'team-a')!;
    const html = tree.renderTreeCell(teamView, NAME_COL);
    expect(html).toContain('data-resource-toggle="team-a"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('jects-scheduler-tree__chevron--open');
    expect(html).toContain('jects-scheduler-tree__cell--group');
  });

  it('renders a spacer (no toggle) for leaf rows', () => {
    const tree = new ResourceTree(FLAT);
    const aliceView = tree.getViewRows().find((r) => r.id === 'alice')!;
    const html = tree.renderTreeCell(aliceView, NAME_COL);
    expect(html).toContain('jects-scheduler-tree__spacer');
    expect(html).not.toContain('data-resource-toggle');
  });

  it('escapes HTML in the resource value', () => {
    const tree = new ResourceTree([{ id: 'x', name: '<b>Hi</b>' }]);
    const html = tree.renderTreeCell(tree.getViewRows()[0]!, NAME_COL);
    expect(html).toContain('&lt;b&gt;Hi&lt;/b&gt;');
    expect(html).not.toContain('<b>Hi</b>');
  });

  it('uses a column renderer when supplied (precedence over field)', () => {
    const tree = new ResourceTree(FLAT);
    const col: ResourceColumnConfig = {
      field: 'name',
      renderer: (r) => `<i>${String(r.id)}</i>`,
    };
    const html = tree.renderTreeCell(tree.getViewRows()[0]!, col);
    expect(html).toContain('<i>team-a</i>');
  });
});

describe('ResourceTree — toggle click handling', () => {
  it('toggles the node when a toggle affordance is clicked', async () => {
    const tree = new ResourceTree(FLAT);
    const host = document.createElement('div');
    host.innerHTML = tree.renderTreeCell(
      tree.getViewRows().find((r) => r.id === 'team-a')!,
      NAME_COL,
    );
    const btn = host.querySelector<HTMLElement>('[data-resource-toggle]')!;
    const handled = tree.handleToggleClick(btn);
    expect(handled).toBe(true);
    // Allow the async toggle microtask to settle.
    await Promise.resolve();
    expect(tree.isExpanded('team-a')).toBe(false);
  });

  it('returns false for clicks outside a toggle', () => {
    const tree = new ResourceTree(FLAT);
    const el = document.createElement('span');
    expect(tree.handleToggleClick(el)).toBe(false);
    expect(tree.handleToggleClick(null)).toBe(false);
  });
});

describe('ResourceTree — lifecycle', () => {
  it('factory builds an instance', () => {
    expect(resourceTree(FLAT)).toBeInstanceOf(ResourceTree);
  });

  it('repaints the view after the underlying store changes', () => {
    const tree = new ResourceTree(FLAT);
    expect(tree.count()).toBe(5);
    tree.store.add({ id: 'dave', name: 'Dave' } as never);
    tree.invalidate();
    expect(tree.count()).toBe(6);
  });

  it('destroy() is idempotent and detaches the store listener', () => {
    const tree = new ResourceTree(FLAT);
    let toggles = 0;
    tree.events.on('resourceToggle', () => toggles++);
    tree.destroy();
    tree.destroy();
    // After destroy the emitter is cleared; store mutations no longer mark dirty.
    tree.store.collapse('team-a');
    expect(toggles).toBe(0);
  });
});
