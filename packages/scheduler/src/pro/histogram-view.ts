/**
 * Scheduler PRO — Resource Histogram + Utilization view widgets.
 *
 * Thin presentational `Widget`s over the pure computations in `histogram.ts`.
 * They extend the core `Widget`, are token-pure, and register with the factory
 * (`resourcehistogram` / `resourceutilization`). Both take resolved resources +
 * events (or a live `Scheduler`'s stores) and paint per-resource bars.
 */

import { Widget, createEl, register, type WidgetConfig, type WidgetEvents } from '@jects/core';
import type { TimeSpan, DurationMs } from '@jects/timeline-core';
import type { ResourceModel, EventModel, AssignmentModel } from '../contract.js';
import {
  computeHistograms,
  computeUtilization,
  type ResourceHistogram,
} from './histogram.js';

export interface HistogramViewConfig extends WidgetConfig {
  resources: ResourceModel[];
  events: EventModel[];
  assignments?: AssignmentModel[];
  range: TimeSpan;
  /** Bucket width in ms. Default one day. */
  slotMs?: DurationMs;
  /** Default capacity when a resource omits one. Default 1. */
  defaultCapacity?: number;
  /** Title shown above the chart. */
  title?: string;
}

export class HistogramView extends Widget<HistogramViewConfig, WidgetEvents> {
  protected buildEl(): HTMLElement {
    // A data table — not a `role=img` — so each bucket's allocated/capacity and
    // an explicit (non-color) "over capacity" indicator are exposed to AT. The
    // table also carries a descriptive caption summarizing peaks/overallocations.
    const el = createEl('div', { className: 'jects-resource-histogram' });
    el.setAttribute('role', 'group');
    return el;
  }

  protected override render(): void {
    const cfg = this.config;
    const histograms = computeHistograms({
      resources: cfg.resources ?? [],
      events: cfg.events ?? [],
      ...(cfg.assignments ? { assignments: cfg.assignments } : {}),
      range: cfg.range,
      ...(cfg.slotMs !== undefined ? { slotMs: cfg.slotMs } : {}),
      ...(cfg.defaultCapacity !== undefined ? { defaultCapacity: cfg.defaultCapacity } : {}),
    });
    this.el.setAttribute('aria-label', this.summaryLabel(cfg.title, histograms));

    const frag = document.createDocumentFragment();
    if (cfg.title) {
      const h = createEl('div', { className: 'jects-resource-histogram__title' });
      h.textContent = cfg.title;
      frag.appendChild(h);
    }
    for (const series of histograms) frag.appendChild(this.renderSeries(series));
    this.el.replaceChildren(frag);
  }

  /** A complete textual summary (peaks + which resources are over capacity). */
  private summaryLabel(title: string | undefined, histograms: ResourceHistogram[]): string {
    const base = title ?? 'Resource histogram';
    const over = histograms.filter((h) => h.buckets.some((b) => b.overallocated));
    const peakOf = (h: ResourceHistogram): string =>
      `${h.resourceName} peak ${h.peak}`;
    const peaks = histograms.map(peakOf).join(', ');
    const overText =
      over.length > 0
        ? ` Over capacity: ${over.map((h) => h.resourceName).join(', ')}.`
        : ' No resources over capacity.';
    return `${base}. ${peaks}.${overText}`;
  }

  private renderSeries(series: ResourceHistogram): HTMLElement {
    const row = createEl('div', { className: 'jects-resource-histogram__row' });
    const overBuckets = series.buckets.filter((b) => b.overallocated).length;
    row.setAttribute(
      'aria-label',
      `${series.resourceName}: peak ${series.peak}` +
        (overBuckets > 0
          ? `, over capacity in ${overBuckets} bucket${overBuckets === 1 ? '' : 's'}`
          : ', within capacity'),
    );
    const label = createEl('div', { className: 'jects-resource-histogram__label' });
    label.textContent = series.resourceName;
    const track = createEl('div', { className: 'jects-resource-histogram__track' });
    const max = Math.max(series.peak, 1);
    for (const bucket of series.buckets) {
      const bar = createEl('div', { className: 'jects-resource-histogram__bar' });
      const pct = (bucket.allocated / max) * 100;
      bar.style.height = `${Math.min(100, pct)}%`;
      const over = bucket.overallocated;
      bar.classList.toggle('jects-resource-histogram__bar--over', over);
      // Text alternative for each bucket: allocated/capacity + explicit over-
      // capacity wording (not color-only). Both title (mouse) and aria-label (AT).
      const text =
        `${bucket.allocated}/${bucket.capacity}` + (over ? ' (over capacity)' : '');
      bar.title = text;
      bar.setAttribute('role', 'img');
      bar.setAttribute('aria-label', text);
      if (over) {
        const flag = createEl('span', { className: 'jects-resource-histogram__over-flag' });
        flag.textContent = '!';
        flag.setAttribute('aria-hidden', 'true');
        bar.appendChild(flag);
      }
      track.appendChild(bar);
    }
    row.append(label, track);
    return row;
  }
}

export interface UtilizationViewConfig extends HistogramViewConfig {
  /** Width of the meter track in px (for label spacing). Default 200. */
  meterWidth?: number;
}

export class UtilizationView extends Widget<UtilizationViewConfig, WidgetEvents> {
  protected buildEl(): HTMLElement {
    const el = createEl('div', { className: 'jects-resource-utilization' });
    el.setAttribute('role', 'list');
    return el;
  }

  protected override render(): void {
    const cfg = this.config;
    const histograms = computeHistograms({
      resources: cfg.resources ?? [],
      events: cfg.events ?? [],
      ...(cfg.assignments ? { assignments: cfg.assignments } : {}),
      range: cfg.range,
      ...(cfg.slotMs !== undefined ? { slotMs: cfg.slotMs } : {}),
      ...(cfg.defaultCapacity !== undefined ? { defaultCapacity: cfg.defaultCapacity } : {}),
    });
    const summaries = computeUtilization(histograms);
    const frag = document.createDocumentFragment();
    if (cfg.title) {
      const h = createEl('div', { className: 'jects-resource-utilization__title' });
      h.textContent = cfg.title;
      frag.appendChild(h);
    }
    for (const s of summaries) {
      const row = createEl('div', { className: 'jects-resource-utilization__row' });
      row.setAttribute('role', 'listitem');
      const label = createEl('div', { className: 'jects-resource-utilization__label' });
      label.textContent = s.resourceName;
      const meter = createEl('div', { className: 'jects-resource-utilization__meter' });
      meter.setAttribute('role', 'meter');
      meter.setAttribute('aria-valuemin', '0');
      meter.setAttribute('aria-valuemax', '100');
      const pct = Math.round(Math.min(1, s.mean) * 100);
      meter.setAttribute('aria-valuenow', String(pct));
      meter.setAttribute('aria-label', `${s.resourceName} utilization`);
      const fill = createEl('div', { className: 'jects-resource-utilization__fill' });
      fill.style.width = `${pct}%`;
      fill.classList.toggle('jects-resource-utilization__fill--over', s.peak > 1);
      meter.appendChild(fill);
      const value = createEl('div', { className: 'jects-resource-utilization__value' });
      value.textContent = `${pct}%`;
      row.append(label, meter, value);
      frag.appendChild(row);
    }
    this.el.replaceChildren(frag);
  }
}

register(
  'resourcehistogram',
  HistogramView as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => HistogramView,
);
register(
  'resourceutilization',
  UtilizationView as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => UtilizationView,
);
