/**
 * axe-core a11y browser test for Form (real Chromium via Vitest browser mode).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Asserts zero serious/critical violations (Quality Gate Q2), including the
 * invalid state where per-field errors must be programmatically associated with
 * each control (text/number/textarea via their own error slot; every other
 * control via aria-describedby + aria-invalid on its focusable element).
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { Form } from './form.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
// Side-effect imports: register the Wave-1 controls the form composes.
import '../fields/text-field.js';
import '../fields/number-field.js';
import '../fields/text-area.js';
import '../choice/select.js';
import '../choice/combobox.js';
import '../choice/checkbox.js';
import '../choice/switch.js';
import '../choice/radio-group.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
  // Popups (select/combobox listboxes) mount to document.body — clean up.
  document
    .querySelectorAll('.jects-select__listbox, .jects-combobox__listbox')
    .forEach((n) => n.remove());
});

const colorOpts = [
  { value: 'r', label: 'Red' },
  { value: 'g', label: 'Green' },
];

function fullForm(): Form {
  return new Form(host, {
    ariaLabel: 'Account form',
    layout: { cols: 2, fieldsets: [{ legend: 'Profile', description: 'Tell us about you' }] },
    fields: [
      { name: 'name', control: 'text', label: 'Full name', rules: { required: true } },
      { name: 'age', control: 'number', label: 'Age', rules: { numeric: true } },
      { name: 'bio', control: 'textarea', label: 'Bio' },
      { name: 'color', control: 'select', label: 'Color', props: { options: colorOpts } },
      { name: 'fruit', control: 'combobox', label: 'Fruit', props: { options: colorOpts } },
      { name: 'agree', control: 'checkbox', label: 'I agree', group: 'Profile' },
      { name: 'notify', control: 'switch', label: 'Notify me', group: 'Profile' },
      { name: 'plan', control: 'radio', label: 'Plan', props: { options: colorOpts }, group: 'Profile' },
    ],
  });
}

describe('Form a11y (axe-core)', () => {
  it('has no serious/critical violations in the pristine state', async () => {
    const f = fullForm();
    await expectNoA11yViolations(host);
    f.destroy();
  });

  it('has no serious/critical violations when fields are invalid (errors associated)', async () => {
    const f = fullForm();
    // Force every field invalid so each error path renders + associates.
    await f.validate();
    await expectNoA11yViolations(host);
    f.destroy();
  });

  it('text/number/textarea push the error into the control (aria-describedby wired)', async () => {
    const f = new Form(host, {
      ariaLabel: 'Login',
      fields: [{ name: 'email', control: 'text', label: 'Email', rules: { required: true } }],
    });
    await f.validateField('email');
    await expectNoA11yViolations(host);
    f.destroy();
  });

  it('non-text controls expose aria-invalid + aria-describedby without violations', async () => {
    const f = new Form(host, {
      ariaLabel: 'Prefs',
      fields: [
        { name: 'color', control: 'select', label: 'Color', props: { options: colorOpts }, rules: { required: true } },
        { name: 'plan', control: 'radio', label: 'Plan', props: { options: colorOpts }, rules: { required: true } },
        { name: 'agree', control: 'checkbox', label: 'Agree', rules: { required: true } },
      ],
    });
    await f.validate();
    await expectNoA11yViolations(host);
    f.destroy();
  });

  it('has no violations after a re-render via update() (schema change)', async () => {
    const f = fullForm();
    f.update({ fields: [{ name: 'q', control: 'text', label: 'Question', rules: { required: true } }] });
    await f.validate();
    await expectNoA11yViolations(host);
    f.destroy();
  });
});
