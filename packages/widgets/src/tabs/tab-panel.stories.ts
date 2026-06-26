/**
 * TabPanel stories — framework-free usage examples for the docs app.
 */
import { TabPanel, type TabPanelConfig } from './tab-panel.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => TabPanel;
}

const story = (name: string, config: TabPanelConfig): Story => ({
  name,
  render: (host) => new TabPanel(host, config),
});

export const stories: Story[] = [
  story('Basic', {
    ariaLabel: 'Account',
    items: [
      { id: 'profile', label: 'Profile', content: '<p>Your profile details.</p>' },
      { id: 'billing', label: 'Billing', content: '<p>Manage your subscription.</p>' },
      { id: 'team', label: 'Team', content: '<p>Invite teammates here.</p>' },
    ],
  }),
  story('Lazy panels', {
    ariaLabel: 'Lazy',
    lazy: true,
    items: [
      { id: 'one', label: 'One', content: (host) => (host.textContent = 'Built on first activation #1') },
      { id: 'two', label: 'Two', content: (host) => (host.textContent = 'Built on first activation #2') },
    ],
  }),
  story('Closable tabs', {
    ariaLabel: 'Files',
    closable: true,
    items: [
      { id: 'a', label: 'a.ts', content: '<pre>export const a = 1;</pre>' },
      { id: 'b', label: 'b.ts', content: '<pre>export const b = 2;</pre>' },
      { id: 'c', label: 'c.ts', content: '<pre>export const c = 3;</pre>' },
    ],
  }),
];
