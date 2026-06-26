/**
 * `ResourceAssignmentView` — a small, framework-free `Widget` that renders the
 * resource assignments of a single task as a row of chips (initials + name +
 * units), flagging over-allocated resources. It is the canonical visual surface
 * for the resource data layer and the thing the a11y/visual browser test
 * exercises. It is presentation-only: it reads a `ResourceApi` and repaints; it
 * never mutates the model itself.
 *
 * It is additive (its own Widget + CSS); it does NOT touch the `Gantt` class.
 */

import './resource.css';
import { Widget, createEl, register, type Model, type RecordId } from '@jects/core';
import type { WidgetConfig, WidgetEvents } from '@jects/core';
import type { ResolvedAssignment, ResourceApi } from './resource-contract.js';

const BLOCK = 'jects-resource-chips';

export interface ResourceAssignmentViewConfig<
  T extends Model = Model,
  R extends Model = Model,
> extends WidgetConfig {
  /** The resource surface to read assignments + over-allocation from. */
  api: ResourceApi<T, R>;
  /** The task whose assignments to show. */
  taskId: RecordId;
  /** Accessible label for the chip group. Default `'Assigned resources'`. */
  label?: string;
}

export interface ResourceAssignmentViewEvents extends WidgetEvents {
  /** A resource chip was activated (click / Enter / Space). */
  chipActivate: { resourceId: RecordId; native: Event };
}

export class ResourceAssignmentView<
  T extends Model = Model,
  R extends Model = Model,
> extends Widget<ResourceAssignmentViewConfig<T, R>, ResourceAssignmentViewEvents> {
  protected override defaults(): Partial<ResourceAssignmentViewConfig<T, R>> {
    return { label: 'Assigned resources' } as Partial<ResourceAssignmentViewConfig<T, R>>;
  }

  protected buildEl(): HTMLElement {
    const el = createEl('div', { className: BLOCK });
    el.setAttribute('role', 'list');
    return el;
  }

  protected override render(): void {
    const { api, taskId, label } = this.config;
    this.el.setAttribute('aria-label', label ?? 'Assigned resources');
    this.el.replaceChildren();

    const assignments = api.getAssignmentsFor(taskId);
    if (assignments.length === 0) {
      const empty = createEl('span', {
        className: `${BLOCK}__empty`,
        text: 'Unassigned',
      });
      empty.setAttribute('role', 'listitem');
      this.el.append(empty);
      return;
    }

    for (const resolved of assignments) {
      this.el.append(this.buildChip(resolved));
    }
  }

  private buildChip(resolved: ResolvedAssignment<R>): HTMLElement {
    const { assignment, resource, units } = resolved;
    const name = (resource?.name as string | undefined) ?? String(assignment.resourceId);
    const over = this.config.api.isOverAllocated(assignment.resourceId);

    const chip = createEl('span', {
      className: `${BLOCK}__chip${over ? ` ${BLOCK}__chip--over` : ''}`,
    });
    chip.setAttribute('role', 'listitem');
    chip.tabIndex = 0;
    chip.dataset.resourceId = String(assignment.resourceId);
    const unitsLabel = units !== 100 ? ` at ${units}%` : '';
    const overLabel = over ? ' (over-allocated)' : '';
    chip.setAttribute('aria-label', `${name}${unitsLabel}${overLabel}`);

    const avatar = createEl('span', { className: `${BLOCK}__avatar`, text: initials(name) });
    avatar.setAttribute('aria-hidden', 'true');
    const text = createEl('span', { className: `${BLOCK}__name`, text: name });

    chip.append(avatar, text);
    if (units !== 100) {
      chip.append(createEl('span', { className: `${BLOCK}__units`, text: `${units}%` }));
    }

    const activate = (native: Event): void => {
      this.emit('chipActivate', { resourceId: assignment.resourceId, native });
    };
    chip.addEventListener('click', activate);
    chip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate(e);
      }
    });
    return chip;
  }
}

/** First-letter initials (max 2) for a resource name. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

register(
  'resourceAssignmentView',
  ResourceAssignmentView as unknown as new (
    host: HTMLElement | string,
    config?: Record<string, unknown>,
  ) => ResourceAssignmentView,
);
