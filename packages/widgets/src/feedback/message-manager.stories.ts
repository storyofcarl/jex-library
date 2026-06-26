/**
 * Feedback stories — framework-free usage examples for the docs app.
 *
 * Toast stories mount a MessageManager and immediately fire a representative
 * toast. Dialog stories render a trigger button that opens the imperative
 * alert/confirm/prompt modal.
 */
import {
  MessageManager,
  alert,
  confirm,
  prompt,
  type MessageManagerConfig,
  type ToastOptions,
} from './message-manager.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => MessageManager | HTMLElement;
}

const toastStory = (
  name: string,
  managerConfig: MessageManagerConfig,
  toast: ToastOptions,
): Story => ({
  name,
  render: (host) => {
    const m = new MessageManager(host, managerConfig);
    m.push(toast);
    return m;
  },
});

const dialogStory = (name: string, label: string, open: () => void): Story => ({
  name,
  render: (host) => {
    const btn = document.createElement('button');
    btn.className = 'jects-dialog__btn jects-dialog__btn--ok';
    btn.textContent = label;
    btn.addEventListener('click', open);
    host.appendChild(btn);
    return btn;
  },
});

export const stories: Story[] = [
  toastStory(
    'Toast — info',
    { position: 'top-right' },
    { title: 'Heads up', message: 'A new version is available.', variant: 'info', timeout: 0 },
  ),
  toastStory(
    'Toast — success',
    { position: 'top-right' },
    { title: 'Saved', message: 'Your changes are live.', variant: 'success', timeout: 0 },
  ),
  toastStory(
    'Toast — warning',
    { position: 'bottom-right' },
    { title: 'Low storage', message: 'You are near your quota.', variant: 'warning', timeout: 0 },
  ),
  toastStory(
    'Toast — error',
    { position: 'bottom-center' },
    { title: 'Upload failed', message: 'Check your connection.', variant: 'error', timeout: 0 },
  ),
  dialogStory('Dialog — alert', 'Show alert', () => {
    void alert({ title: 'Notice', message: 'Operation completed.', variant: 'success' });
  }),
  dialogStory('Dialog — confirm', 'Show confirm', () => {
    void confirm({
      title: 'Delete item?',
      message: 'This action cannot be undone.',
      variant: 'error',
      okText: 'Delete',
    });
  }),
  dialogStory('Dialog — prompt', 'Show prompt', () => {
    void prompt({ title: 'Rename', message: 'Enter a new name', defaultValue: 'untitled' });
  }),
];
