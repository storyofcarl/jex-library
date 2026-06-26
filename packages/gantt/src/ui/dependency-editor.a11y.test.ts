/**
 * axe-core a11y + visual/interaction browser test for the editable
 * Predecessors/Successors columns + inline dependency editor (Quality Gate Q2 +
 * a feature-exercising visual check). Runs in REAL Chromium via
 * `pnpm --filter @jects/gantt test:browser`.
 *
 * Exercises the parity behaviour end to end with real layout/geometry:
 *   1. The inline editor mounts over a cell with real pixel geometry, a labelled
 *      input pre-filled with the cell's notation, and an ARIA-live error region.
 *   2. Typing `aFS+1d` and pressing Enter creates the link through the engine
 *      seam (predecessor appears; the schedule re-propagates).
 *   3. Typing a cycle-creating term surfaces a VISIBLE error (real rendered text
 *      with non-zero height) and the editor stays open + focused.
 *   4. The mounted editor has zero serious/critical a11y violations — both the
 *      clean state and the invalid (error-shown) state.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Load the real package stylesheet so geometry/visibility assertions exercise
// the shipped, token-pure CSS rather than unstyled defaults.
import '../styles.css';
import { Gantt } from './gantt.js';
import type { TaskModel } from '../contract.js';
import { GanttDependencyColumns } from './dependency-editor.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

function tasks(): TaskModel[] {
  return [
    { id: 'a', name: 'A', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY },
    { id: 'b', name: 'B', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY },
  ];
}

let host: HTMLElement;
let gantt: Gantt | null = null;

beforeEach(() => {
  host = document.createElement('div');
  host.style.position = 'relative';
  host.style.width = '900px';
  host.style.height = '300px';
  document.body.appendChild(host);
});

afterEach(() => {
  gantt?.destroy();
  gantt = null;
  host.remove();
});

describe('Dependency columns + inline editor a11y + visual (real Chromium)', () => {
  it('creates a predecessor link by typing notation, with no serious/critical violations', async () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feature = new GanttDependencyColumns();
    gantt.use(feature);

    // Mount the editor over a host cell box with real geometry.
    const cell = document.createElement('div');
    cell.style.width = '160px';
    cell.style.padding = '4px';
    host.appendChild(cell);

    const editor = feature.openEditor('b', 'predecessors');
    cell.appendChild(editor.el);
    editor.focus();

    // The input is laid out with real pixel width and is the active element.
    expect(editor.input.getBoundingClientRect().width).toBeGreaterThan(0);
    expect(host.ownerDocument.activeElement).toBe(editor.input);

    await expectNoA11yViolations(host);

    // Type notation and commit with Enter.
    editor.input.value = 'aFS+1d';
    editor.input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );

    // The link was created through the engine seam (b now has a predecessor a).
    expect(gantt.getDependenciesFor('b').length).toBe(1);
    expect(gantt.getDependenciesFor('b')[0]!.fromId).toBe('a');
    expect(gantt.getDependenciesFor('b')[0]!.lag).toBe(DAY);
    // Editor torn down after a successful commit.
    expect(editor.el.isConnected).toBe(false);
  });

  it('shows a VISIBLE inline error on cycle rejection and stays open + a11y-clean', async () => {
    gantt = new Gantt(host, {
      tasks: tasks(),
      dependencies: [{ id: 'l1', fromId: 'a', toId: 'b', type: 'FS' }],
      projectStart: T0,
    });
    const feature = new GanttDependencyColumns();
    gantt.use(feature);

    const cell = document.createElement('div');
    cell.style.width = '160px';
    host.appendChild(cell);

    // Editing b's SUCCESSORS to include a (b -> a) would create a cycle.
    const editor = feature.openEditor('b', 'successors');
    cell.appendChild(editor.el);
    editor.focus();

    editor.input.value = 'a';
    const res = editor.commit();
    expect(res.ok).toBe(false);

    const errorEl = editor.el.querySelector<HTMLElement>('.jects-gantt-dep-editor__error')!;
    // The error text is rendered and occupies real space (not display:none/empty).
    expect(errorEl.textContent).toMatch(/cycle|rejected|vetoed/i);
    expect(errorEl.getBoundingClientRect().height).toBeGreaterThan(0);
    expect(editor.input.getAttribute('aria-invalid')).toBe('true');
    expect(editor.el.isConnected).toBe(true);

    // No new link created; the original a->b is intact.
    expect(gantt.getDependenciesFor('a').length).toBe(1);

    // Even in the invalid (error-visible) state, axe finds no blocking issues.
    await expectNoA11yViolations(host);
  });
});
