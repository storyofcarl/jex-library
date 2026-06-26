/** jsdom unit test — runs in the default `pnpm test`. Covers render, interaction, events, validation. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Form } from './form.js';
// Side-effect imports: register the Wave-1 controls the form composes.
import '../fields/text-field.js';
import '../fields/number-field.js';
import '../fields/text-area.js';
import '../choice/select.js';
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
});

function setInput(form: Form, name: string, value: string): void {
  const cell = form.el.querySelector(`[data-field="${name}"]`)!;
  const input = cell.querySelector('input, textarea') as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('Form (jsdom)', () => {
  it('renders a <form> with a control per field', () => {
    const f = new Form(host, {
      fields: [
        { name: 'a', control: 'text', label: 'A' },
        { name: 'b', control: 'number', label: 'B' },
      ],
    });
    const formEl = host.querySelector('form.jects-form')!;
    expect(formEl).toBeTruthy();
    expect(formEl.querySelector('[data-field="a"]')).toBeTruthy();
    expect(formEl.querySelector('[data-field="b"]')).toBeTruthy();
    expect(formEl.querySelector('.jects-form__submit')).toBeTruthy();
    f.destroy();
  });

  it('getValue collects values across control types', () => {
    const f = new Form(host, {
      fields: [
        { name: 'name', control: 'text', value: 'Carl' },
        { name: 'count', control: 'number', value: 3 },
        { name: 'agree', control: 'checkbox', value: true },
      ],
    });
    const v = f.getValue();
    expect(v.name).toBe('Carl');
    expect(v.count).toBe(3);
    expect(v.agree).toBe(true);
    f.destroy();
  });

  it('setValue patches field values', () => {
    const f = new Form(host, {
      fields: [{ name: 'name', control: 'text', value: 'A' }],
    });
    f.setValue({ name: 'B' });
    expect(f.getValue().name).toBe('B');
    f.destroy();
  });

  it('emits change when a field input changes', () => {
    const f = new Form(host, { fields: [{ name: 'name', control: 'text' }] });
    const spy = vi.fn();
    f.on('change', spy);
    setInput(f, 'name', 'hi');
    expect(spy).toHaveBeenCalled();
    const payload = spy.mock.calls.at(-1)![0];
    expect(payload.name).toBe('name');
    expect(payload.value).toBe('hi');
    f.destroy();
  });

  it('validate: required fails when empty, passes when filled', async () => {
    const f = new Form(host, {
      fields: [{ name: 'name', control: 'text', rules: { required: true } }],
    });
    let r = await f.validate();
    expect(r.valid).toBe(false);
    expect(r.errors.name).toBeTruthy();

    f.setValue({ name: 'x' });
    r = await f.validate();
    expect(r.valid).toBe(true);
    f.destroy();
  });

  it('validate: email + minLength + numeric rules', async () => {
    const f = new Form(host, {
      fields: [
        { name: 'email', control: 'text', rules: { email: true } },
        { name: 'user', control: 'text', rules: { minLength: 3 } },
        { name: 'age', control: 'number', rules: { numeric: true, min: 18 } },
      ],
    });
    f.setValue({ email: 'nope', user: 'ab', age: 10 });
    const r = await f.validate();
    expect(r.valid).toBe(false);
    expect(r.errors.email).toBeTruthy();
    expect(r.errors.user).toBeTruthy();
    expect(r.errors.age).toBeTruthy();

    f.setValue({ email: 'a@b.co', user: 'abcd', age: 21 });
    const r2 = await f.validate();
    expect(r2.valid).toBe(true);
    f.destroy();
  });

  it('validate: custom + async rules', async () => {
    const f = new Form(host, {
      fields: [
        { name: 'a', control: 'text', value: 'bad', rules: { custom: (v) => (v === 'bad' ? 'no' : true) } },
        {
          name: 'b',
          control: 'text',
          value: 'taken',
          rules: { asyncValidate: async (v) => (v === 'taken' ? 'in use' : true) },
        },
      ],
    });
    const r = await f.validate();
    expect(r.valid).toBe(false);
    expect(r.errors.a).toBe('no');
    expect(r.errors.b).toBe('in use');
    f.destroy();
  });

  it('form-level cross-field validation', async () => {
    const f = new Form(host, {
      fields: [
        { name: 'pw', control: 'text', value: 'abc' },
        { name: 'pw2', control: 'text', value: 'xyz' },
      ],
      validate: (values) => (values.pw !== values.pw2 ? { pw2: 'mismatch' } : undefined),
    });
    const r = await f.validate();
    expect(r.valid).toBe(false);
    expect(r.errors.pw2).toBe('mismatch');
    f.destroy();
  });

  it('renders error message + invalid class on validateOnChange (text pushes into control)', async () => {
    const f = new Form(host, {
      fields: [{ name: 'name', control: 'text', rules: { required: true } }],
    });
    await f.validateField('name');
    const cell = f.el.querySelector('[data-field="name"]')!;
    expect(cell.classList.contains('jects-form__cell--invalid')).toBe(true);
    // text/number/textarea push the message into the control's OWN error slot,
    // which wires aria-describedby on the input (no form-owned external element).
    expect(cell.querySelector('.jects-form__field-error')).toBeNull();
    const ctrlErr = cell.querySelector('.jects-field__error') as HTMLElement;
    expect(ctrlErr).toBeTruthy();
    expect(ctrlErr.textContent).toBeTruthy();
    const input = cell.querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(ctrlErr.id);
    f.destroy();
  });

  it('non-text control (select) exposes aria-invalid + aria-describedby on validate', async () => {
    const f = new Form(host, {
      fields: [
        {
          name: 'color',
          control: 'select',
          label: 'Color',
          props: { options: [{ value: 'r', label: 'Red' }] },
          rules: { required: true },
        },
      ],
    });
    await f.validateField('color');
    const cell = f.el.querySelector('[data-field="color"]')!;
    expect(cell.classList.contains('jects-form__cell--invalid')).toBe(true);
    const err = cell.querySelector('.jects-form__field-error') as HTMLElement;
    expect(err.hidden).toBe(false);
    expect(err.textContent).toBeTruthy();
    // The form-owned error region is associated to the control's focusable element.
    const focusable = cell.querySelector(
      'input, button, [tabindex], [role="combobox"], [role="listbox"]',
    ) as HTMLElement;
    expect(focusable).toBeTruthy();
    expect(focusable.getAttribute('aria-invalid')).toBe('true');
    expect((focusable.getAttribute('aria-describedby') ?? '').split(/\s+/)).toContain(err.id);
    f.destroy();
  });

  it('submit emits submit when valid; invalid otherwise', async () => {
    const submitSpy = vi.fn();
    const invalidSpy = vi.fn();
    const f = new Form(host, {
      fields: [{ name: 'name', control: 'text', rules: { required: true } }],
    });
    f.on('submit', submitSpy);
    f.on('invalid', invalidSpy);

    let ok = await f.submit();
    expect(ok).toBe(false);
    expect(invalidSpy).toHaveBeenCalledTimes(1);
    expect(submitSpy).not.toHaveBeenCalled();

    f.setValue({ name: 'Carl' });
    ok = await f.submit();
    expect(ok).toBe(true);
    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(submitSpy.mock.calls[0]![0].values.name).toBe('Carl');
    f.destroy();
  });

  it('beforeSubmit veto cancels submit', async () => {
    const submitSpy = vi.fn();
    const f = new Form(host, { fields: [{ name: 'name', control: 'text', value: 'x' }] });
    f.on('beforeSubmit', () => false);
    f.on('submit', submitSpy);
    const ok = await f.submit();
    expect(ok).toBe(false);
    expect(submitSpy).not.toHaveBeenCalled();
    f.destroy();
  });

  it('native submit event triggers validation/submit', async () => {
    const submitSpy = vi.fn();
    const f = new Form(host, { fields: [{ name: 'name', control: 'text', value: 'x' }] });
    f.on('submit', submitSpy);
    if ((f.el as HTMLFormElement).requestSubmit) {
      (f.el as HTMLFormElement).requestSubmit();
    } else {
      f.el.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }
    await Promise.resolve();
    await Promise.resolve();
    expect(submitSpy).toHaveBeenCalled();
    f.destroy();
  });

  it('reset restores initial values and clears errors', async () => {
    const f = new Form(host, {
      fields: [{ name: 'name', control: 'text', value: 'init', rules: { required: true } }],
    });
    f.setValue({ name: 'changed' });
    await f.validateField('name');
    f.reset();
    expect(f.getValue().name).toBe('init');
    const cell = f.el.querySelector('[data-field="name"]')!;
    expect(cell.classList.contains('jects-form__cell--invalid')).toBe(false);
    f.destroy();
  });

  it('lays out fieldsets and applies column count', () => {
    const f = new Form(host, {
      layout: {
        cols: 2,
        fieldsets: [{ legend: 'Group A' }],
      },
      fields: [{ name: 'x', control: 'text', group: 'Group A' }],
    });
    const fs = f.el.querySelector('fieldset.jects-form__fieldset')!;
    expect(fs.querySelector('legend')!.textContent).toBe('Group A');
    expect(fs.querySelector('[data-field="x"]')).toBeTruthy();
    const grid = f.el.querySelector('.jects-form__grid') as HTMLElement;
    expect(grid.style.getPropertyValue('--_form-cols')).toBe('2');
    f.destroy();
  });

  it('destroy removes the form and disposes field widgets', () => {
    const f = new Form(host, { fields: [{ name: 'a', control: 'text' }] });
    const field = f.getField('a')!;
    f.destroy();
    expect(host.querySelector('form')).toBeNull();
    expect(field.isDestroyed).toBe(true);
    expect(f.isDestroyed).toBe(true);
  });
});
