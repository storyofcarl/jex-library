/**
 * Advanced scheduling-mode section stories — framework-free usage examples for
 * the {@link SchedulingModeSection} (per-task manual/auto + ASAP/ALAP +
 * constraint/date + effort-driven) and the default today/status project line.
 *
 * Each story mounts the section into a host element so the mode toggle, the
 * conditional constraint-date row, and the effort controls are visible and
 * interactive; the last story renders the default project lines (today + project
 * boundaries) onto a real `ProjectLines` layer.
 */
import { DefaultTimeAxis, WEEK_AND_DAY } from '@jects/timeline-core';
import {
  SchedulingModeSection,
  defaultProjectLines,
  applySchedulingModePatch,
} from './scheduling-mode-section.js';
import { ProjectLines } from './project-lines.js';
import type { TaskModel } from '../contract.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => { destroy(): void };
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 0, 5);

function task(over: Partial<TaskModel> = {}): TaskModel {
  return { id: 't1', name: 'Design', start: T0, end: T0 + 5 * DAY, duration: 5 * DAY, ...over };
}

export const stories: Story[] = [
  {
    name: 'Auto-scheduled (ASAP) — default',
    render(host) {
      const section = new SchedulingModeSection({ task: task() });
      host.append(section.el);
      return { destroy: () => section.destroy() };
    },
  },
  {
    name: 'Manually scheduled — constraint controls disabled',
    render(host) {
      const section = new SchedulingModeSection({
        task: task({ manuallyScheduled: true }),
      });
      host.append(section.el);
      return { destroy: () => section.destroy() };
    },
  },
  {
    name: 'Dated constraint (Must Start On) — date row shown',
    render(host) {
      const section = new SchedulingModeSection({
        task: task({ constraintType: 'mustStartOn', constraintDate: T0 + 2 * DAY }),
      });
      host.append(section.el);
      return { destroy: () => section.destroy() };
    },
  },
  {
    name: 'Effort-enabled — effort + effort-driven controls',
    render(host) {
      // Log the patch + diff as the user edits (illustrates the engine-edit
      // mapping that `applySchedulingModePatch` consumes).
      const log = document.createElement('pre');
      log.style.marginTop = '8px';
      const section = new SchedulingModeSection({
        task: task({ effort: 40 * HOUR, effortDriven: true } as Partial<TaskModel>),
        effortEnabled: true,
        hoursPerDay: 8,
        onChange: () => {
          log.textContent = JSON.stringify(
            { patch: section.getPatch(), diff: section.diff() },
            null,
            2,
          );
        },
      });
      host.append(section.el, log);
      // Reference the engine-edit helper so its role is discoverable from stories.
      void applySchedulingModePatch;
      return { destroy: () => section.destroy() };
    },
  },
  {
    name: 'Default project lines (today + boundaries)',
    render(host) {
      host.style.position = 'relative';
      host.style.height = '240px';
      const range = { start: T0 - 7 * DAY, end: T0 + 40 * DAY };
      const axis = new DefaultTimeAxis({ range, preset: WEEK_AND_DAY, zoom: 1 });
      const lines = new ProjectLines({
        axis,
        projectSpan: { start: T0, end: T0 + 30 * DAY },
        lines: defaultProjectLines({ now: T0 + 10 * DAY, projectBoundaries: true }),
      });
      host.append(lines.el);
      lines.setHeight(220);
      return { destroy: () => lines.destroy() };
    },
  },
];

export default stories;
