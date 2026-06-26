/**
 * axe-core a11y browser test for Tree (real Chromium).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Asserts zero serious/critical violations (Quality Gate Q2).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Tree } from './tree.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

const sampleData = () => [
  {
    id: 1,
    text: 'Root A',
    children: [
      { id: 2, text: 'Child A1' },
      { id: 3, text: 'Child A2' },
    ],
  },
  { id: 4, text: 'Root B' },
];

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Tree a11y (axe-core)', () => {
  it('has no serious/critical violations on initial render', async () => {
    const t = new Tree(host, { data: sampleData(), label: 'Files' });
    await expectNoA11yViolations(host);
    t.destroy();
  });

  it('establishes roving focus (one treeitem has tabindex=0) from first paint', async () => {
    const t = new Tree(host, { data: sampleData(), label: 'Files' });
    // Regression guard for the activeId field-initializer ordering bug: a
    // focusable treeitem must exist on the very first render.
    const focusable = host.querySelectorAll('.jects-tree__node[tabindex="0"]');
    expect(focusable.length).toBe(1);
    await expectNoA11yViolations(host);
    t.destroy();
  });

  it('has no serious/critical violations when expanded with checkboxes', async () => {
    const t = new Tree(host, { data: sampleData(), checkboxes: true, label: 'Files' });
    host.querySelector<HTMLElement>('[data-twisty="1"]')!.click();
    expect(host.textContent).toContain('Child A1');
    await expectNoA11yViolations(host);
    t.destroy();
  });
});
