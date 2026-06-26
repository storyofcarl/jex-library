/**
 * Layout stories — framework-free usage examples (classic border layout).
 */
import { Layout, type LayoutConfig } from './layout.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Layout;
}

const story = (name: string, config: LayoutConfig): Story => ({
  name,
  render: (host) => {
    host.style.height = '360px';
    return new Layout(host, config);
  },
});

const cell = (label: string): string => `<div style="padding:1rem">${label}</div>`;

export const stories: Story[] = [
  story('North + Center', {
    north: { content: cell('Header'), size: 0.15 },
    center: { content: cell('Main content') },
  }),
  story('West sidebar + Center', {
    west: { content: cell('Sidebar'), size: 0.25 },
    center: { content: cell('Main content') },
  }),
  story('Full border layout', {
    north: { content: cell('North'), size: 0.12 },
    south: { content: cell('South'), size: 0.12 },
    west: { content: cell('West'), size: 0.2 },
    east: { content: cell('East'), size: 0.2 },
    center: { content: cell('Center') },
  }),
  story('Collapsible regions', {
    west: { content: cell('Collapsible West'), size: 0.25, collapsible: true },
    east: { content: cell('Collapsed East'), size: 0.25, collapsible: true, collapsed: true },
    center: { content: cell('Center') },
  }),
];
