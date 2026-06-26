/**
 * RichText stories — framework-free usage examples for the docs app.
 * Each story returns a host-mounting function.
 */
import { RichText, type RichTextConfig } from './rich-text.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => RichText;
}

const story = (name: string, config: RichTextConfig): Story => ({
  name,
  render: (host) => new RichText(host, config),
});

export const stories: Story[] = [
  story('Default', {
    value: '<h2>Welcome</h2><p>Start typing your <strong>rich</strong> content…</p>',
  }),
  story('Empty with placeholder', {
    value: '',
    placeholder: 'Write your story…',
  }),
  story('Minimal toolbar', {
    value: '<p>Just the essentials.</p>',
    toolbar: ['bold', 'italic', 'underline', 'separator', 'ul', 'ol', 'separator', 'link'],
  }),
  story('No toolbar', {
    value: '<p>Toolbar hidden — editable only.</p>',
    toolbar: [],
  }),
  story('With list and quote', {
    value:
      '<h3>Checklist</h3><ul><li>First</li><li>Second</li></ul><blockquote>A calm quote.</blockquote>',
  }),
  story('Tables, images & color', {
    value:
      '<h3>Quarterly report</h3>' +
      '<p>Use the toolbar to insert <strong>images</strong>, <strong>tables</strong>, ' +
      'and apply <span style="color: rgb(37, 99, 235)">text color</span> or ' +
      '<span style="background-color: rgb(254, 240, 138)">highlights</span>.</p>' +
      '<table><tbody><tr><th>Region</th><th>Total</th></tr>' +
      '<tr><td>North</td><td>120</td></tr><tr><td>South</td><td>98</td></tr></tbody></table>',
  }),
  story('Start in HTML source view', {
    value: '<h2>Edit the raw HTML</h2><p>Toggle the <code>&lt;&gt;</code> button to switch back.</p>',
    sourceView: true,
  }),
  story('Read-only', {
    value: '<h2>Read only</h2><p>You cannot edit this content.</p>',
    readOnly: true,
  }),
  story('Disabled', {
    value: '<p>Disabled editor.</p>',
    disabled: true,
  }),
];
