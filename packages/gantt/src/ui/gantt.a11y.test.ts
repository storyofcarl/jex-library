/**
 * axe-core a11y browser test for the Gantt widget (Quality Gate Q2).
 * Run with `pnpm --filter @jects/gantt test:browser`.
 * Mounts the Gantt in real Chromium and asserts zero serious/critical violations.
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { Gantt } from './gantt.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
import type { TaskModel, DependencyModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

let host: HTMLElement;
let gantt: Gantt | null = null;

const tasks: TaskModel[] = [
  { id: 'p', name: 'Phase 1' },
  { id: 'a', name: 'Design', parentId: 'p', start: T0, duration: 3 * DAY, end: T0 + 3 * DAY },
  {
    id: 'b',
    name: 'Build',
    parentId: 'p',
    start: T0 + 3 * DAY,
    duration: 3 * DAY,
    end: T0 + 6 * DAY,
    percentDone: 0.4,
  },
  { id: 'm', name: 'Launch', parentId: 'p', start: T0 + 6 * DAY, milestone: true },
];

const dependencies: DependencyModel[] = [{ id: 'l1', fromId: 'a', toId: 'b', type: 'FS' }];

beforeEach(() => {
  host = document.createElement('div');
  host.style.height = '400px';
  document.body.appendChild(host);
});

afterEach(() => {
  gantt?.destroy();
  gantt = null;
  host.remove();
});

describe('Gantt a11y (axe-core, real Chromium)', () => {
  it('a populated Gantt has no serious/critical violations', async () => {
    gantt = new Gantt(host, { tasks, dependencies, projectStart: T0 });
    await expectNoA11yViolations(host);
  });

  it('with critical path hidden still passes axe', async () => {
    gantt = new Gantt(host, { tasks, dependencies, projectStart: T0, showCriticalPath: false });
    gantt.setCriticalPathVisible(false);
    await expectNoA11yViolations(host);
  });

  it('with a baseline overlay shown passes axe', async () => {
    gantt = new Gantt(host, { tasks, dependencies, projectStart: T0 });
    gantt.captureBaseline('base-1', 'Original');
    gantt.showBaseline('base-1');
    await expectNoA11yViolations(host);
  });
});
