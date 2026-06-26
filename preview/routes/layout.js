/** Route: layout. */
import { el, card } from '../shell/dom.js';
import { section, Layout, Splitter, Panel, Container } from '../shell/registry.js';

const cell = (label) => `<div style="padding:1rem">${label}</div>`;
const pane = (label) => `<div style="padding:1rem;height:100%;box-sizing:border-box">${label}</div>`;

export function register() {
  section('layout', 'Layout', 'Border layout, splitters, panels and flex/grid containers.', (grid) => {
    grid.appendChild(card('Layout (border regions)', (h) => {
      const host = el('div', { class: 'g-host-layout' });
      h.appendChild(host);
      new Layout(host, {
        north: { content: cell('Header'), size: 0.2 },
        west: { content: cell('Sidebar'), size: 0.25, collapsible: true },
        center: { content: cell('Main content') },
      });
    }, { block: true }));
    grid.appendChild(card('Splitter (drag the bar)', (h) => {
      const host = el('div', { class: 'g-host-splitter' });
      h.appendChild(host);
      new Splitter(host, { orientation: 'horizontal', first: pane('Left'), second: pane('Right') });
    }, { block: true }));
    grid.appendChild(card('Panel (collapsible)', (h) => {
      new Panel(h, { title: 'Settings', collapsible: true, body: '<p>Click the header to collapse.</p>', footer: '<span>Saved 2 minutes ago</span>' });
    }, { block: true }));
    grid.appendChild(card('Container (flex / grid)', (h) => {
      new Container(h, {
        role: 'toolbar', ariaLabel: 'Actions', gap: 2, align: 'center',
        items: [
          { type: 'button', text: 'Save', variant: 'primary' },
          { type: 'button', text: 'Cancel', variant: 'ghost' },
        ],
      });
    }, { block: true }));
  });
}
