/**
 * Tabbar stories — framework-free usage examples for the docs app.
 */
import { Tabbar, type TabbarConfig } from './tabbar.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Tabbar;
}

const story = (name: string, config: TabbarConfig): Story => ({
  name,
  render: (host) => new Tabbar(host, config),
});

const basicItems = [
  { id: 'overview', label: 'Overview' },
  { id: 'activity', label: 'Activity' },
  { id: 'settings', label: 'Settings' },
];

export const stories: Story[] = [
  story('Basic', { items: basicItems, active: 'overview', ariaLabel: 'Sections' }),
  story('With disabled tab', {
    items: [
      { id: 'a', label: 'Enabled' },
      { id: 'b', label: 'Disabled', disabled: true },
      { id: 'c', label: 'Also enabled' },
    ],
    ariaLabel: 'Sections',
  }),
  story('Closable', {
    items: [
      { id: 'doc1', label: 'README.md' },
      { id: 'doc2', label: 'index.ts' },
      { id: 'doc3', label: 'styles.css' },
    ],
    closable: true,
    ariaLabel: 'Open files',
  }),
  story('Overflow (many tabs)', {
    items: Array.from({ length: 14 }, (_, i) => ({ id: `t${i}`, label: `Tab ${i + 1}` })),
    active: 't0',
    ariaLabel: 'Many tabs',
  }),
];
