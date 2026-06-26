/** DataView stories — framework-free usage examples for the docs app. */
import { DataView, type DataViewConfig } from './data-view.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => DataView;
}

const people = Array.from({ length: 9 }, (_, i) => ({
  id: i + 1,
  text: `Person ${i + 1}`,
  role: i % 2 ? 'Engineer' : 'Designer',
}));

const story = (name: string, config: DataViewConfig): Story => ({
  name,
  render: (host) => new DataView(host, config),
});

export const stories: Story[] = [
  story('Basic', { data: people }),
  story('Multi-select', { data: people, selectionMode: 'multi' }),
  story('Custom card', {
    data: people,
    cardTemplate: (r) => {
      const p = r as { text: string; role: string };
      return `<div class="jects-dataview__title">${p.text}</div><div>${p.role}</div>`;
    },
  }),
  story('Narrow cards', { data: people, minCardWidth: 140, gap: 8 }),
  story('Empty', { data: [], emptyText: 'No records' }),
];
