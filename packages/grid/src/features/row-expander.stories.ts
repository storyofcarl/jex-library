/**
 * Stories / usage examples for RowExpanderFeature (row expander / master-detail).
 *
 * These are plain factory functions a docs shell can mount; each returns the host
 * element with a live Grid + the feature installed.
 */
import type { Model } from '@jects/core';
import { Grid } from '../engine/grid.js';
import type { ColumnDef } from '../contract.js';
import { RowExpanderFeature } from './row-expander.js';

interface Employee extends Model {
  id: number;
  name: string;
  title: string;
  salary: number;
  bio: string;
}

const PEOPLE: Employee[] = [
  { id: 1, name: 'Ada Lovelace', title: 'Analyst', salary: 120000, bio: 'Pioneer of computing; wrote the first algorithm intended for a machine.' },
  { id: 2, name: 'Linus Torvalds', title: 'Kernel Lead', salary: 180000, bio: 'Created Linux and Git; maintains the kernel mainline.' },
  { id: 3, name: 'Grace Hopper', title: 'Rear Admiral', salary: 150000, bio: 'Invented the first compiler; popularized machine-independent languages.' },
];

const columns: ColumnDef<Employee>[] = [
  { field: 'name', header: 'Name', width: 200 },
  { field: 'title', header: 'Title', width: 160 },
  { field: 'salary', header: 'Salary', type: 'number', width: 120 },
];

/** Basic master-detail: a card of extra info per expanded row. */
export function basicMasterDetail(): HTMLElement {
  const host = document.createElement('div');
  host.style.height = '360px';
  const grid = new Grid<Employee>(host, { data: PEOPLE.map((p) => ({ ...p })), columns });
  grid.use(
    new RowExpanderFeature<Employee>({
      detailHeight: 140,
      renderer: (ctx) => {
        const card = document.createElement('div');
        card.style.display = 'grid';
        card.style.gap = '6px';
        const h = document.createElement('strong');
        h.textContent = `${ctx.row.name} — ${ctx.row.title}`;
        const bio = document.createElement('p');
        bio.style.margin = '0';
        bio.textContent = ctx.row.bio;
        card.append(h, bio);
        return card;
      },
    }),
  );
  return host;
}

/** Accordion (single-expand) mode with an initially expanded row. */
export function accordion(): HTMLElement {
  const host = document.createElement('div');
  host.style.height = '360px';
  const grid = new Grid<Employee>(host, { data: PEOPLE.map((p) => ({ ...p })), columns });
  grid.use(
    new RowExpanderFeature<Employee>({
      single: true,
      expanded: [1],
      renderer: (ctx) => `Salary band review pending for ${ctx.row.name}.`,
    }),
  );
  return host;
}

/** A nested grid as the detail content (master-detail with a sub-grid). */
export function nestedGridDetail(): HTMLElement {
  const host = document.createElement('div');
  host.style.height = '420px';
  const grid = new Grid<Employee>(host, { data: PEOPLE.map((p) => ({ ...p })), columns });
  grid.use(
    new RowExpanderFeature<Employee>({
      detailHeight: 180,
      renderer: (ctx) => {
        const sub = document.createElement('div');
        sub.style.height = '160px';
        new Grid(sub, {
          data: [
            { id: 1, period: 'Q1', amount: Math.round(ctx.row.salary / 4) },
            { id: 2, period: 'Q2', amount: Math.round(ctx.row.salary / 4) },
          ],
          columns: [
            { field: 'period', header: 'Period', width: 120 },
            { field: 'amount', header: 'Paid', type: 'number', width: 140 },
          ],
        });
        return sub;
      },
    }),
  );
  return host;
}
