/** Route: overlays & feedback. */
import { el, card } from '../shell/dom.js';
import { triggerBtn } from '../shell/export-menu.js';
import {
  section, Button, Tooltip, Popup, Mask, Window, Dialog, MessageManager,
  alert, confirm, prompt,
} from '../shell/registry.js';

export function register() {
  section('overlays', 'Overlays & Feedback', 'Tooltips, popups, masks, floating windows, dialogs and toasts. Use the buttons to launch the transient overlays.', (grid) => {
    grid.appendChild(card('Tooltip', (h) => {
      const target = new Button(h, { text: 'Hover me', variant: 'secondary' });
      new Tooltip(h, { target: target.el, text: 'Tooltip on top', placement: 'top', showDelay: 100 });
    }));
    grid.appendChild(card('Popup (click to anchor)', (h) => {
      const anchor = new Button(h, { text: 'Open popup', variant: 'outline' });
      const popup = new Popup(h, {
        anchor: anchor.el, placement: 'bottom', align: 'start',
        html: '<strong>Menu</strong><ul style="margin:.4rem 0 0;padding-left:1.1rem"><li>One</li><li>Two</li></ul>',
      });
      anchor.el.addEventListener('click', () => popup.toggle());
    }));
    grid.appendChild(card('Mask (overlay spinner)', (h) => {
      const box = el('div', { style: 'position:relative;width:100%;height:120px;border:1px solid oklch(var(--jects-border));border-radius:8px' });
      h.appendChild(box);
      h.appendChild(triggerBtn('Show mask 1.5s', () => {
        const m = new Mask(box, { message: 'Loading…' });
        setTimeout(() => m.destroy(), 1500);
      }));
    }, { block: true }));
    grid.appendChild(card('Window (floating, draggable)', (h) => {
      h.appendChild(triggerBtn('Open window', () => {
        new Window(document.body, {
          title: 'Untitled', x: 120, y: 120, width: 380,
          text: 'A draggable, resizable floating panel. Drag the header to move it.',
          minimizable: true,
        });
      }, 'primary'));
    }));
    grid.appendChild(card('Dialog (modal, promise)', (h) => {
      h.appendChild(triggerBtn('Open dialog', async () => {
        const d = new Dialog(document.body, {
          title: 'Delete file?', text: 'This action cannot be undone.', tone: 'destructive',
          actions: [
            { key: 'cancel', text: 'Cancel', variant: 'outline' },
            { key: 'delete', text: 'Delete', variant: 'destructive', autoFocus: true },
          ],
        });
        await d.open();
      }, 'destructive'));
    }));
    grid.appendChild(card('MessageManager — Toasts', (h) => {
      const mm = new MessageManager(document.body, { position: 'top-right' });
      h.appendChild(triggerBtn('Info toast', () =>
        mm.push({ title: 'Heads up', message: 'A new version is available.', variant: 'info' })));
      h.appendChild(triggerBtn('Success toast', () =>
        mm.push({ title: 'Saved', message: 'Your changes are live.', variant: 'success' })));
      h.appendChild(triggerBtn('Error toast', () =>
        mm.push({ title: 'Upload failed', message: 'Check your connection.', variant: 'error' })));
    }, { block: true }));
    grid.appendChild(card('Imperative alert / confirm / prompt', (h) => {
      h.appendChild(triggerBtn('alert()', () => alert({ title: 'Notice', message: 'Operation completed.', variant: 'success' })));
      h.appendChild(triggerBtn('confirm()', () => confirm({ title: 'Delete item?', message: 'This cannot be undone.', variant: 'error', okText: 'Delete' })));
      h.appendChild(triggerBtn('prompt()', () => prompt({ title: 'Rename', message: 'Enter a new name', defaultValue: 'untitled' })));
    }, { block: true }));
  });
}
