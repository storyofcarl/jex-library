/**
 * Window stories — framework-free usage examples for the docs app.
 * Each story returns a host-mounting function that creates a Window.
 */
import { Window, type WindowConfig } from './window.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Window;
}

const story = (name: string, config: WindowConfig): Story => ({
  name,
  render: (host) => new Window(host, config),
});

export const stories: Story[] = [
  story('Basic', {
    title: 'Untitled',
    text: 'A draggable, resizable floating panel. Drag the header to move it.',
    x: 60,
    y: 60,
  }),
  story('Wide', {
    title: 'Wide panel',
    html: '<p>Use the corner and edge handles to resize.</p>',
    width: 640,
    height: 360,
  }),
  story('Non-resizable', {
    title: 'Fixed size',
    text: 'This window cannot be resized.',
    resizable: false,
  }),
  story('Modal', {
    title: 'Modal window',
    text: 'A backdrop blocks the page; Escape or backdrop click closes it.',
    modal: true,
  }),
  story('Maximized', {
    title: 'Maximized',
    text: 'Starts maximized; use the restore control to shrink it.',
    maximized: true,
  }),
  story('With minimize', {
    title: 'All controls',
    text: 'Minimize, maximize and close.',
    minimizable: true,
  }),
];
