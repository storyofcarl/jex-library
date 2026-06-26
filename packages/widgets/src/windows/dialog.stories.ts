/**
 * Dialog stories — framework-free usage examples for the docs app.
 * Each story returns a host-mounting function that creates a Dialog. Call
 * `dialog.open()` to receive a Promise that resolves with the chosen action key.
 */
import { Dialog, type DialogConfig } from './dialog.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Dialog;
}

const story = (name: string, config: DialogConfig): Story => ({
  name,
  render: (host) => {
    const d = new Dialog(host, config);
    // In the docs shell, surface the resolved key for demonstration.
    void d.open().then((key) => {
      console.log('dialog resolved:', key);
    });
    return d;
  },
});

export const stories: Story[] = [
  story('Confirm', {
    title: 'Delete file?',
    text: 'This action cannot be undone.',
    tone: 'destructive',
    actions: [
      { key: 'cancel', text: 'Cancel', variant: 'outline' },
      { key: 'delete', text: 'Delete', variant: 'destructive', autoFocus: true },
    ],
  }),
  story('OK / Cancel', {
    title: 'Save changes?',
    text: 'Your edits will be saved to the document.',
    actions: [
      { key: 'cancel', text: 'Cancel', variant: 'ghost' },
      { key: 'save', text: 'Save', variant: 'primary', autoFocus: true },
    ],
  }),
  story('Acknowledge', {
    title: 'Heads up',
    text: 'The export finished with warnings.',
    actions: [{ key: 'ok', text: 'Got it', variant: 'primary', autoFocus: true }],
  }),
  story('Apply (stays open)', {
    title: 'Settings',
    html: '<p>Apply does not close the dialog.</p>',
    actions: [
      { key: 'apply', text: 'Apply', variant: 'secondary', closeOnAction: false },
      { key: 'close', text: 'Close', variant: 'primary' },
    ],
  }),
];
