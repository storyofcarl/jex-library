/**
 * Accessibility + interaction test for the resource tree / grouping feature —
 * real Chromium via `vitest --config vitest.browser.config.ts`. Asserts zero
 * serious/critical axe violations (Quality Gate Q2) and exercises the toggle
 * affordance end-to-end: the chevron buttons expose `aria-expanded`, clicking a
 * group header collapses/expands its lane subtree, and the rolled-up event count
 * on a collapsed parent is announced via the resource ids it aggregates.
 *
 * The feature is a standalone module (see resource-tree.ts wireNotes), so this
 * test mounts the tree's locked-column markup into a real list panel — the same
 * markup the Scheduler emits once `ResourceTree.renderTreeCell` is wired into
 * `paintResourceColumns`.
 */
import { describe, it, afterEach, expect } from 'vitest';
import '@jects/theme/style.css';
import '../styles.css';
import { ResourceTree } from './resource-tree.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
import type { ResourceModel, ResourceColumnConfig } from '../contract.js';

const RESOURCES: ResourceModel[] = [
  { id: 'team-a', name: 'Team A' },
  { id: 'alice', name: 'Alice', parentId: 'team-a' },
  { id: 'bob', name: 'Bob', parentId: 'team-a' },
  { id: 'team-b', name: 'Team B' },
  { id: 'carol', name: 'Carol', parentId: 'team-b' },
];
const NAME_COL: ResourceColumnConfig = { field: 'name', text: 'Resource' };

let host: HTMLElement;
const trees: ResourceTree[] = [];

afterEach(() => {
  for (const t of trees.splice(0)) t.destroy();
  host?.remove();
});

/** Render the tree's visible rows into a real, labelled locked-column panel. */
function mountPanel(tree: ResourceTree): HTMLElement {
  host = document.createElement('div');
  host.style.width = '260px';
  host.style.height = '300px';
  document.body.appendChild(host);

  const panel = document.createElement('div');
  panel.className = 'jects-scheduler__resources';
  panel.setAttribute('role', 'tree');
  panel.setAttribute('aria-label', 'Resources');
  renderRows(tree, panel);

  // Wire the delegated toggle click (mirrors the Scheduler integration): on a
  // toggle hit, re-render the panel's rows from the (now updated) view.
  panel.addEventListener('click', (e) => {
    if (tree.handleToggleClick(e.target)) {
      e.preventDefault();
      void Promise.resolve().then(() => renderRows(tree, panel));
    }
  });

  host.appendChild(panel);
  return host;
}

/** (Re)render the tree's visible rows into an existing panel element. */
function renderRows(tree: ResourceTree, panel: HTMLElement): void {
  panel.replaceChildren();
  for (const view of tree.getViewRows()) {
    const row = document.createElement('div');
    row.className = 'jects-scheduler__resource-row';
    if (view.isGroup) row.classList.add('jects-scheduler__resource-row--group');
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-level', String(view.depth + 1));
    if (!view.leaf) row.setAttribute('aria-expanded', String(view.expanded));
    row.dataset['resourceId'] = String(view.id);
    const cell = document.createElement('div');
    cell.className = 'jects-scheduler__resource-cell';
    cell.innerHTML = tree.renderTreeCell(view, NAME_COL);
    row.appendChild(cell);
    panel.appendChild(row);
  }
}

describe('ResourceTree a11y + interaction', () => {
  it('has no serious/critical axe violations (fully expanded tree)', async () => {
    const tree = new ResourceTree(RESOURCES);
    trees.push(tree);
    const h = mountPanel(tree);
    await expectNoA11yViolations(h);
  });

  it('every group exposes an aria-expanded toggle button with an accessible name', () => {
    const tree = new ResourceTree(RESOURCES);
    trees.push(tree);
    const h = mountPanel(tree);
    const toggles = h.querySelectorAll<HTMLButtonElement>('.jects-scheduler-tree__toggle');
    expect(toggles.length).toBe(2); // team-a, team-b
    for (const btn of Array.from(toggles)) {
      expect(btn.getAttribute('aria-expanded')).toBe('true');
      // Accessible name comes from aria-label ("Collapse Team A" etc.).
      expect(btn.getAttribute('aria-label')).toMatch(/Collapse Team [AB]/);
      expect(btn.tagName).toBe('BUTTON');
    }
  });

  it('leaf rows render an indented label and no toggle', () => {
    const tree = new ResourceTree(RESOURCES, { indent: 18 });
    trees.push(tree);
    const h = mountPanel(tree);
    const alice = h.querySelector<HTMLElement>('[data-resource-id="alice"]')!;
    expect(alice.querySelector('.jects-scheduler-tree__toggle')).toBeNull();
    expect(alice.querySelector('.jects-scheduler-tree__spacer')).toBeTruthy();
    const cell = alice.querySelector<HTMLElement>('.jects-scheduler-tree__cell')!;
    expect(cell.style.paddingInlineStart).toBe('18px');
    expect(cell.textContent).toContain('Alice');
  });

  it('clicking a group toggle collapses its subtree (state + aggregation)', async () => {
    const tree = new ResourceTree(RESOURCES);
    trees.push(tree);
    const h = mountPanel(tree);
    const toggle = h.querySelector<HTMLButtonElement>(
      '[data-resource-toggle="team-a"]',
    )!;
    toggle.click();
    await Promise.resolve();

    expect(tree.isExpanded('team-a')).toBe(false);
    // Re-render reflects the collapse: alice/bob no longer visible.
    const ids = tree.getViewRows().map((r) => r.id);
    expect(ids).toEqual(['team-a', 'team-b', 'carol']);
    // The collapsed parent now rolls up its children's events.
    expect(tree.resourceIdsForRow('team-a').sort()).toEqual(['alice', 'bob', 'team-a']);
  });

  it('group-header rows carry a tree role with aria-level depth', () => {
    const tree = new ResourceTree(RESOURCES);
    trees.push(tree);
    const h = mountPanel(tree);
    const teamA = h.querySelector<HTMLElement>('[data-resource-id="team-a"]')!;
    expect(teamA.getAttribute('role')).toBe('treeitem');
    expect(teamA.getAttribute('aria-level')).toBe('1');
    expect(teamA.getAttribute('aria-expanded')).toBe('true');
    expect(teamA.classList.contains('jects-scheduler__resource-row--group')).toBe(true);
    const alice = h.querySelector<HTMLElement>('[data-resource-id="alice"]')!;
    expect(alice.getAttribute('aria-level')).toBe('2');
  });
});
