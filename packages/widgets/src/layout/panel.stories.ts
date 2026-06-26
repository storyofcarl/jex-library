/**
 * Panel stories — framework-free usage examples.
 */
import { Panel, type PanelConfig } from './panel.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Panel;
}

const story = (name: string, config: PanelConfig): Story => ({
  name,
  render: (host) => new Panel(host, config),
});

export const stories: Story[] = [
  story('Basic', {
    title: 'Details',
    body: '<p>A titled, bordered region with a body.</p>',
  }),
  story('With tools', {
    title: 'Files',
    tools: '<button type="button" class="jects-btn jects-btn--ghost jects-btn--sm">Refresh</button>',
    body: '<p>Header tools sit on the right.</p>',
  }),
  story('Collapsible', {
    title: 'Settings',
    collapsible: true,
    body: '<p>Click the header to collapse this body.</p>',
  }),
  story('Collapsed initially', {
    title: 'Advanced',
    collapsible: true,
    collapsed: true,
    body: '<p>Starts collapsed.</p>',
  }),
  story('With footer', {
    title: 'Editor',
    body: '<p>Body content.</p>',
    footer: '<span>Saved 2 minutes ago</span>',
  }),
  story('Flat', {
    title: 'Flat panel',
    flat: true,
    body: '<p>No border / background chrome.</p>',
  }),
];
