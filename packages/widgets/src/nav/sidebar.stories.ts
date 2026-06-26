/** Sidebar stories — canonical usage examples. */
import { Sidebar, type SidebarConfig } from './sidebar.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Sidebar;
}

const story = (name: string, config: SidebarConfig): Story => ({
  name,
  render: (host) => new Sidebar(host, config),
});

const items: SidebarConfig['items'] = [
  { id: 'dashboard', text: 'Dashboard', icon: 'menu' },
  {
    id: 'content',
    text: 'Content',
    icon: 'edit',
    children: [
      { id: 'posts', text: 'Posts' },
      { id: 'pages', text: 'Pages' },
      { id: 'media', text: 'Media' },
    ],
  },
  { id: 'inbox', text: 'Inbox', icon: 'info', badge: '5' },
  { id: 'settings', text: 'Settings', icon: 'filter' },
];

export const stories: Story[] = [
  story('Expanded', { title: 'Acme', items, active: 'dashboard', expanded: ['content'] }),
  story('Collapsed (mini)', { title: 'Acme', items, active: 'dashboard', collapsed: true }),
];
