/**
 * @jects/scheduler — resource tree / grouping stories.
 *
 * Living docs for the hierarchical resource feature. Each function builds a
 * `ResourceTree` and renders its flattened, expansion-aware view into a locked
 * resource panel (the same markup the Scheduler emits once the feature is wired
 * into `paintResourceColumns` — see `resource-tree.ts` wireNotes). They double
 * as customizer preview scenes so the indentation, chevrons, and group bands
 * recolor live with the active theme.
 */

import { ResourceTree } from './resource-tree.js';
import type { ResourceModel, ResourceColumnConfig } from '../contract.js';

const NAME_COL: ResourceColumnConfig = { field: 'name', text: 'Resource' };

const flatResources: ResourceModel[] = [
  { id: 'eng', name: 'Engineering' },
  { id: 'alice', name: 'Alice', parentId: 'eng' },
  { id: 'bob', name: 'Bob', parentId: 'eng' },
  { id: 'frontend', name: 'Frontend', parentId: 'eng' },
  { id: 'carol', name: 'Carol', parentId: 'frontend' },
  { id: 'ops', name: 'Operations' },
  { id: 'dave', name: 'Dave', parentId: 'ops' },
];

/** Render the tree's current visible rows into a labelled tree panel. */
function paint(tree: ResourceTree, panel: HTMLElement): void {
  panel.replaceChildren();
  for (const view of tree.getViewRows()) {
    const row = document.createElement('div');
    row.className = 'jects-scheduler__resource-row';
    if (view.isGroup) row.classList.add('jects-scheduler__resource-row--group');
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-level', String(view.depth + 1));
    if (!view.leaf) row.setAttribute('aria-expanded', String(view.expanded));
    row.dataset['resourceId'] = String(view.id);
    row.style.height = '36px';
    const cell = document.createElement('div');
    cell.className = 'jects-scheduler__resource-cell';
    cell.innerHTML = tree.renderTreeCell(view, NAME_COL);
    row.appendChild(cell);
    panel.appendChild(row);
  }
}

function mountPanel(host: HTMLElement, tree: ResourceTree): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'jects-scheduler__resources';
  panel.setAttribute('role', 'tree');
  panel.setAttribute('aria-label', 'Resources');
  panel.style.width = '240px';
  paint(tree, panel);
  panel.addEventListener('click', (e) => {
    if (tree.handleToggleClick(e.target)) {
      e.preventDefault();
      void Promise.resolve().then(() => paint(tree, panel));
    }
  });
  host.appendChild(panel);
  return panel;
}

/** A fully-expanded resource hierarchy with group headers + indentation. */
export function expanded(host: HTMLElement): ResourceTree {
  const tree = new ResourceTree(flatResources);
  mountPanel(host, tree);
  return tree;
}

/** Only top-level groups expanded — click a chevron to drill in. */
export function collapsed(host: HTMLElement): ResourceTree {
  const tree = new ResourceTree(flatResources, { expanded: ['eng', 'ops'] });
  mountPanel(host, tree);
  return tree;
}

/** Pre-nested data (children supplied directly) with wider indentation. */
export function nested(host: HTMLElement): ResourceTree {
  const tree = new ResourceTree(
    [
      {
        id: 'plant',
        name: 'Plant 1',
        children: [
          { id: 'line-a', name: 'Line A', children: [{ id: 'm1', name: 'Mill 1' }] },
          { id: 'line-b', name: 'Line B' },
        ],
      },
    ] as ResourceModel[],
    { indent: 22 },
  );
  mountPanel(host, tree);
  return tree;
}
