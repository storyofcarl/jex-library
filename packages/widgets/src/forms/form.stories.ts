/**
 * Form stories — framework-free usage examples for the docs app, mirroring the
 * Button stories shape. Each story returns a host-mounting function.
 */
import { Form, type FormConfig } from './form.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Form;
}

const story = (name: string, config: FormConfig): Story => ({
  name,
  render: (host) => new Form(host, config),
});

export const stories: Story[] = [
  story('Basic (single column)', {
    ariaLabel: 'Contact form',
    fields: [
      { name: 'name', control: 'text', label: 'Name', rules: { required: true } },
      {
        name: 'email',
        control: 'text',
        label: 'Email',
        rules: { required: true, email: true },
        props: { inputType: 'email' },
      },
      { name: 'message', control: 'textarea', label: 'Message', rules: { maxLength: 280 } },
    ],
    submitText: 'Send',
    resetText: 'Clear',
  }),

  story('Two-column grid with colSpan', {
    ariaLabel: 'Profile form',
    layout: { cols: 2 },
    fields: [
      { name: 'first', control: 'text', label: 'First name', rules: { required: true } },
      { name: 'last', control: 'text', label: 'Last name', rules: { required: true } },
      {
        name: 'bio',
        control: 'textarea',
        label: 'Bio',
        colSpan: 2,
        rules: { maxLength: 500 },
      },
      {
        name: 'age',
        control: 'number',
        label: 'Age',
        rules: { numeric: true, min: 18, max: 120 },
      },
      {
        name: 'role',
        control: 'select',
        label: 'Role',
        props: {
          options: [
            { value: 'eng', label: 'Engineer' },
            { value: 'design', label: 'Designer' },
            { value: 'pm', label: 'Product' },
          ],
        },
      },
    ],
  }),

  story('Fieldsets (grouped)', {
    ariaLabel: 'Account settings',
    layout: {
      cols: 2,
      fieldsets: [
        { legend: 'Account', description: 'Your sign-in details.' },
        { legend: 'Preferences' },
      ],
    },
    fields: [
      { name: 'username', control: 'text', label: 'Username', group: 'Account', rules: { required: true, minLength: 3 } },
      {
        name: 'password',
        control: 'text',
        label: 'Password',
        group: 'Account',
        props: { inputType: 'password' },
        rules: { required: true, minLength: 8 },
      },
      { name: 'newsletter', control: 'switch', label: 'Subscribe to newsletter', group: 'Preferences' },
      { name: 'terms', control: 'checkbox', label: 'I accept the terms', group: 'Preferences', rules: { required: 'You must accept the terms.' } },
    ],
  }),

  story('Cross-field (password confirm)', {
    ariaLabel: 'Change password',
    fields: [
      { name: 'pw', control: 'text', label: 'New password', props: { inputType: 'password' }, rules: { required: true, minLength: 8 } },
      { name: 'pw2', control: 'text', label: 'Confirm password', props: { inputType: 'password' }, rules: { required: true } },
    ],
    validate: (values) =>
      values.pw !== values.pw2 ? { pw2: 'Passwords do not match.' } : undefined,
  }),

  story('Rich controls', {
    ariaLabel: 'Event form',
    layout: { cols: 2 },
    fields: [
      { name: 'title', control: 'text', label: 'Title', rules: { required: true } },
      { name: 'when', control: 'date', label: 'Date' },
      { name: 'start', control: 'time', label: 'Start time' },
      { name: 'color', control: 'color', label: 'Color tag', value: '#3366cc' },
      {
        name: 'priority',
        control: 'radio',
        label: 'Priority',
        props: {
          options: [
            { value: 'low', label: 'Low' },
            { value: 'high', label: 'High' },
          ],
        },
      },
      { name: 'attachments', control: 'file', label: 'Attachments' },
    ],
  }),
];
