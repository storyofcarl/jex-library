/**
 * `EffortPanel` — a small, framework-free `Widget` that visualizes and drives
 * **effort-driven scheduling** for a single task. It is the canonical visual
 * surface for the effort feature and the thing the a11y/visual browser test
 * exercises.
 *
 * It renders the live {effort, duration, units} trio of a task plus a list of
 * its assigned resources, with keyboard-operable controls to add/remove a
 * resource and to bump an assignment's allocation. Every mutation is routed
 * THROUGH a {@link ResourceAwareEngine} (the effort-driven engine), so the
 * displayed duration **reflows** as resources are added/removed — exactly the
 * Bryntum/DHTMLX behaviour. The panel is presentation + thin controls only; the
 * scheduling math lives entirely in `engine/effort.ts`.
 *
 * Additive: its own Widget + CSS; it does NOT touch the `Gantt` class, the
 * contract, the timeline view, or any other agent's module.
 */

import './effort-panel.css';
import { Widget, createEl, register, type Model, type RecordId } from '@jects/core';
import type { WidgetConfig, WidgetEvents } from '@jects/core';
import type { ScheduleChange } from '../contract.js';
import {
  type ResourceAwareEngine,
  type ResourceModel,
  isEffortDriven,
  effortToPersonDays,
  FULL_TIME_UNITS,
} from '../engine/effort.js';

const BLOCK = 'jects-effort-panel';
const MS_PER_DAY = 86_400_000;

export interface EffortPanelConfig<T extends Model = Model> extends WidgetConfig {
  /** The effort-driven engine the panel reads + drives. */
  engine: ResourceAwareEngine<T>;
  /** The task whose effort-driven scheduling is shown. */
  taskId: RecordId;
  /** Resources offered in the "add resource" control. Defaults to all engine resources. */
  resources?: ResourceModel[];
  /** Accessible label for the panel. Default `'Effort-driven scheduling'`. */
  label?: string;
  /** Working hours/day for the person-day readout. Default from engine/8. */
  hoursPerDay?: number;
}

export interface EffortPanelEvents extends WidgetEvents {
  /** The schedule reflowed because the staffing changed (after a mutation). */
  reflow: { taskId: RecordId; changes: ReadonlyArray<ScheduleChange> };
}

/** Format working-ms as a compact `Nd` / `N.Nd` day string. */
function fmtDays(ms: number | undefined): string {
  if (ms == null) return '—';
  const d = ms / MS_PER_DAY;
  return Number.isInteger(d) ? `${d}d` : `${d.toFixed(1)}d`;
}

export class EffortPanel<T extends Model = Model> extends Widget<
  EffortPanelConfig<T>,
  EffortPanelEvents
> {
  protected override defaults(): Partial<EffortPanelConfig<T>> {
    return { label: 'Effort-driven scheduling' } as Partial<EffortPanelConfig<T>>;
  }

  protected buildEl(): HTMLElement {
    const el = createEl('section', { className: BLOCK });
    el.setAttribute('aria-label', this.config.label ?? 'Effort-driven scheduling');
    return el;
  }

  protected override render(): void {
    const { engine, taskId, label } = this.config;
    this.el.setAttribute('aria-label', label ?? 'Effort-driven scheduling');
    this.el.replaceChildren();

    const task = engine.getTask(taskId);
    if (!task) {
      this.el.append(createEl('p', { className: `${BLOCK}__empty`, text: 'No task.' }));
      return;
    }

    const driven = isEffortDriven(task);
    const units = engine.getAssignedUnits(taskId);
    const hpd = this.config.hoursPerDay ?? this.hoursPerDay();

    // ── header / metrics ──────────────────────────────────────────────
    const header = createEl('header', { className: `${BLOCK}__header` });
    const title = createEl('h3', {
      className: `${BLOCK}__title`,
      text: (task.name as string | undefined) ?? String(taskId),
    });
    const mode = createEl('span', {
      className: `${BLOCK}__mode ${BLOCK}__mode--${driven ? 'driven' : 'fixed'}`,
      text: driven ? 'Effort-driven' : 'Fixed duration',
    });
    header.append(title, mode);

    const metrics = createEl('dl', { className: `${BLOCK}__metrics` });
    this.metric(metrics, 'effort', 'Effort', `${fmtDays(task.effort)} (${effortToPersonDays(task.effort ?? 0, hpd).toFixed(1)} pd)`);
    this.metric(metrics, 'duration', 'Duration', fmtDays(task.duration));
    this.metric(metrics, 'units', 'Units', `${units}%`);

    // ── assigned resources ────────────────────────────────────────────
    const list = createEl('ul', { className: `${BLOCK}__assignments` });
    list.setAttribute('aria-label', 'Assigned resources');
    const assignments = engine.getAssignmentsFor(taskId);
    if (assignments.length === 0) {
      const empty = createEl('li', { className: `${BLOCK}__empty`, text: 'Unassigned' });
      list.append(empty);
    } else {
      for (const a of assignments) {
        const res = engine.getResource(a.resourceId);
        const name = (res?.name as string | undefined) ?? String(a.resourceId);
        const u = a.units ?? FULL_TIME_UNITS;
        const li = createEl('li', { className: `${BLOCK}__assignment` });
        li.append(createEl('span', { className: `${BLOCK}__res-name`, text: name }));
        li.append(createEl('span', { className: `${BLOCK}__res-units`, text: `${u}%` }));

        const remove = createEl('button', {
          className: `${BLOCK}__btn ${BLOCK}__btn--remove`,
          text: '−',
        }) as HTMLButtonElement;
        remove.type = 'button';
        remove.setAttribute('aria-label', `Remove ${name} from ${name === String(taskId) ? 'task' : (task.name as string) ?? 'task'}`);
        remove.addEventListener('click', () => this.mutate(engine.unassignResource(a.id)));
        li.append(remove);
        list.append(li);
      }
    }

    // ── add-resource control ──────────────────────────────────────────
    const controls = createEl('div', { className: `${BLOCK}__controls` });
    const available = this.availableResources();
    const select = createEl('select', { className: `${BLOCK}__select` }) as HTMLSelectElement;
    select.setAttribute('aria-label', 'Resource to assign');
    if (available.length === 0) {
      const opt = createEl('option', { text: 'All assigned' }) as HTMLOptionElement;
      opt.value = '';
      select.append(opt);
      select.disabled = true;
    } else {
      for (const r of available) {
        const opt = createEl('option', {
          text: (r.name as string | undefined) ?? String(r.id),
        }) as HTMLOptionElement;
        opt.value = String(r.id);
        select.append(opt);
      }
    }
    const add = createEl('button', {
      className: `${BLOCK}__btn ${BLOCK}__btn--add`,
      text: 'Assign',
    }) as HTMLButtonElement;
    add.type = 'button';
    add.disabled = available.length === 0;
    add.addEventListener('click', () => {
      const id = select.value;
      if (!id) return;
      const match = available.find((r) => String(r.id) === id);
      if (!match) return;
      const { changes } = engine.assignResource(taskId, match.id);
      this.mutate(changes);
    });
    controls.append(select, add);

    this.el.append(header, metrics, list, controls);
  }

  /** Append one `<dt>/<dd>` metric pair. */
  private metric(dl: HTMLElement, key: string, term: string, value: string): void {
    const dt = createEl('dt', { className: `${BLOCK}__metric-term`, text: term });
    const dd = createEl('dd', { className: `${BLOCK}__metric-value`, text: value });
    dd.dataset.metric = key;
    dl.append(dt, dd);
  }

  /** Resources not yet assigned to the task. */
  private availableResources(): ResourceModel[] {
    const { engine, taskId } = this.config;
    const all = this.config.resources ?? [...engine.getResources()];
    const assigned = new Set(engine.getAssignmentsFor(taskId).map((a) => String(a.resourceId)));
    return all.filter((r) => !assigned.has(String(r.id)));
  }

  private hoursPerDay(): number {
    const e = this.config.engine as { getHoursPerDay?: () => number };
    return typeof e.getHoursPerDay === 'function' ? e.getHoursPerDay() : 8;
  }

  /** Re-render after a mutation and notify listeners of the reflow. */
  private mutate(changes: ReadonlyArray<ScheduleChange>): void {
    this.render();
    this.emit('reflow', { taskId: this.config.taskId, changes });
  }
}

register(
  'effortPanel',
  EffortPanel as unknown as new (
    host: HTMLElement | string,
    config?: Record<string, unknown>,
  ) => EffortPanel,
);
