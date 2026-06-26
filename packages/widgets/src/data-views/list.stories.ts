/** List stories — framework-free usage examples for the docs app. */
import { List, type ListConfig } from './list.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => List;
}

const data = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, text: `Item ${i + 1}` }));

const story = (name: string, config: ListConfig): Story => ({
  name,
  render: (host) => new List(host, config),
});

export const stories: Story[] = [
  story('Basic', { data: data(50) }),
  story('Virtualized (100k rows)', { data: data(100_000), height: 360 }),
  story('Multi-select', { data: data(50), selectionMode: 'multi' }),
  story('Custom template', {
    data: data(50),
    itemSize: 48,
    itemTemplate: (r, i) =>
      `<span class="jects-list__label">#${i + 1} — ${(r as { text: string }).text}</span>`,
  }),
  story('Empty', { data: [], emptyText: 'No results found' }),
];
