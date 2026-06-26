/**
 * FilePicker (Vault) stories — framework-free usage examples for the docs app.
 */
import { FilePicker, type FilePickerConfig } from './file-picker.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => FilePicker;
}

const story = (name: string, config: FilePickerConfig): Story => ({
  name,
  render: (host) => new FilePicker(host, config),
});

export const stories: Story[] = [
  story('Default', { hint: 'Any file type, multiple allowed' }),
  story('Single file', { multiple: false, label: 'Drop a file', hint: 'Only one file' }),
  story('Images only', { accept: 'image/*', hint: 'PNG, JPG, GIF…' }),
  story('Documents', { accept: '.pdf,.doc,.docx', hint: 'PDF or Word' }),
  story('Max 1 MB', { maxSize: 1024 * 1024, hint: 'Up to 1 MB each' }),
  story('Disabled', { disabled: true, label: 'Uploads disabled' }),
];
