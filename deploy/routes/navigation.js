/** Route: navigation. */
import { el, card } from '../shell/dom.js';
import {
  section, Toolbar, Menu, ContextMenu, Sidebar, Ribbon, Tabbar, TabPanel, Pagination,
} from '../shell/registry.js';

export function register() {
  section('navigation', 'Navigation', 'Toolbar, menu, context menu, sidebar, ribbon, tabs and pagination.', (grid) => {
    grid.appendChild(card('Toolbar', (h) => {
      new Toolbar(h, { items: [
        { id: 'new', text: 'New', icon: 'plus', variant: 'primary' },
        { id: 'edit', text: 'Edit', icon: 'edit' },
        { separator: true },
        { id: 'delete', text: 'Delete', icon: 'trash', variant: 'ghost' },
      ] });
    }, { block: true }));
    grid.appendChild(card('Menu (submenus + checkable)', (h) => {
      new Menu(h, { items: [
        { id: 'new', text: 'New', icon: 'plus', shortcut: 'Ctrl+N' },
        { id: 'open', text: 'Open Recent', children: [
          { id: 'r1', text: 'project-a' }, { id: 'r2', text: 'project-b' },
        ] },
        { separator: true },
        { id: 'wrap', text: 'Word Wrap', checkable: true, checked: true },
      ] });
    }, { block: true }));
    grid.appendChild(card('ContextMenu (right-click box)', (h) => {
      const target = el('div', { text: 'Right-click inside this box',
        style: 'padding:2rem;border:1px dashed currentColor;border-radius:8px;text-align:center;width:100%' });
      h.appendChild(target);
      new ContextMenu(h, { target, items: [
        { id: 'cut', text: 'Cut' }, { id: 'copy', text: 'Copy' }, { id: 'paste', text: 'Paste' },
        { separator: true }, { id: 'del', text: 'Delete', icon: 'trash' },
      ] });
    }, { block: true }));
    grid.appendChild(card('Sidebar', (h) => {
      const host = el('div', { class: 'g-host-sidebar' });
      h.appendChild(host);
      new Sidebar(host, {
        title: 'Acme', active: 'dashboard', expanded: ['content'],
        items: [
          { id: 'dashboard', text: 'Dashboard', icon: 'menu' },
          { id: 'content', text: 'Content', icon: 'edit', children: [
            { id: 'posts', text: 'Posts' }, { id: 'pages', text: 'Pages' },
          ] },
          { id: 'inbox', text: 'Inbox', icon: 'info', badge: '5' },
          { id: 'settings', text: 'Settings', icon: 'filter' },
        ],
      });
    }, { block: true }));
    grid.appendChild(card('Ribbon', (h) => {
      new Ribbon(h, { tabs: [
        { id: 'home', text: 'Home', groups: [
          { title: 'Clipboard', commands: [
            { id: 'paste', text: 'Paste', icon: 'plus' },
            { id: 'cut', icon: 'minus', label: 'Cut' },
            { id: 'copy', icon: 'check', label: 'Copy' },
          ] },
          { title: 'Editing', commands: [
            { id: 'find', icon: 'search', label: 'Find' },
            { id: 'filter', icon: 'filter', label: 'Filter' },
          ] },
        ] },
        { id: 'insert', text: 'Insert', groups: [
          { title: 'Media', commands: [{ id: 'image', text: 'Image', icon: 'edit' }] },
        ] },
      ] });
    }, { block: true }));
    grid.appendChild(card('Tabbar', (h) => {
      new Tabbar(h, { ariaLabel: 'Sections', active: 'overview', items: [
        { id: 'overview', label: 'Overview' }, { id: 'specs', label: 'Specs' }, { id: 'reviews', label: 'Reviews' },
      ] });
    }, { block: true }));
    grid.appendChild(card('TabPanel', (h) => {
      new TabPanel(h, { ariaLabel: 'Account', items: [
        { id: 'profile', label: 'Profile', content: '<p>Your profile details.</p>' },
        { id: 'billing', label: 'Billing', content: '<p>Manage your subscription.</p>' },
        { id: 'team', label: 'Team', content: '<p>Invite teammates here.</p>' },
      ] });
    }, { block: true }));
    grid.appendChild(card('Pagination', (h) => {
      new Pagination(h, { total: 240, pageSize: 20, page: 3, pageSizeOptions: [10, 20, 50, 100] });
    }, { block: true }));
  });
}
