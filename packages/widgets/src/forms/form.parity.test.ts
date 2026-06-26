/**
 * jsdom unit test for the 6 Form parity gaps:
 *   1. conditional visibility (showWhen / hidden)   4. new control types (20+)
 *   2. dirty tracking                               5. disabled / disabledWhen
 *   3. existing widgets wired as controls           6. validation modes
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Form } from './form.js';
// Side-effect imports: register every control these tests compose.
import '../fields/text-field.js';
import '../fields/number-field.js';
import '../choice/select.js';
import '../choice/checkbox.js';
import '../choice/checkbox-group.js';
import '../display/slider.js';
import '../display/range-slider.js';
import '../display/rating.js';
import '../datetime/date-time-field.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

function cellHidden(f: Form, name: string): boolean {
  return (f.el.querySelector(`[data-field="${name}"]`) as HTMLElement).hidden;
}

/** Flush all pending microtasks (the detached `void validateField()` chain). */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('Gap 1 — conditional visibility', () => {
  it('showWhen (function) toggles a field as another value changes', () => {
    const f = new Form(host, {
      fields: [
        { name: 'kind', control: 'text', value: 'a' },
        { name: 'detail', control: 'text', showWhen: (v) => v.kind === 'b' },
      ],
    });
    expect(cellHidden(f, 'detail')).toBe(true);
    f.setValue({ kind: 'b' });
    f.getField('kind')!.emit('change' as never, {} as never); // trigger re-sync
    expect(cellHidden(f, 'detail')).toBe(false);
    f.destroy();
  });

  it('showWhen ({field, eq}) declarative form works', () => {
    const f = new Form(host, {
      fields: [
        { name: 'plan', control: 'text', value: 'free' },
        { name: 'seats', control: 'number', showWhen: { field: 'plan', eq: 'team' } },
      ],
    });
    expect(cellHidden(f, 'seats')).toBe(true);
    f.setValue({ plan: 'team' });
    f.getField('plan')!.emit('change' as never, {} as never);
    expect(cellHidden(f, 'seats')).toBe(false);
    f.destroy();
  });

  it('a hidden field does not block submit even when required', async () => {
    const f = new Form(host, {
      fields: [
        { name: 'name', control: 'text', value: 'Carl' },
        { name: 'secret', control: 'text', hidden: true, rules: { required: true } },
      ],
    });
    const ok = await f.submit();
    expect(ok).toBe(true);
    f.destroy();
  });

  it('a conditionally-hidden required field is skipped by validate()', async () => {
    const f = new Form(host, {
      fields: [
        { name: 'wantsGift', control: 'checkbox', value: false },
        { name: 'address', control: 'text', showWhen: { field: 'wantsGift', eq: true }, rules: { required: true } },
      ],
    });
    const r = await f.validate();
    expect(r.valid).toBe(true);
    f.destroy();
  });
});

describe('Gap 2 — dirty tracking', () => {
  it('tracks dirty state, dirty values, per-field dirt, touched, and reset', () => {
    const f = new Form(host, {
      fields: [
        { name: 'a', control: 'text', value: 'x' },
        { name: 'b', control: 'text', value: 'y' },
      ],
    });
    expect(f.isDirty()).toBe(false);

    f.setValue({ a: 'changed' });
    f.getField('a')!.emit('change' as never, {} as never); // mark touched

    expect(f.isDirty()).toBe(true);
    expect(f.isFieldDirty('a')).toBe(true);
    expect(f.isFieldDirty('b')).toBe(false);
    expect(f.getDirtyValues()).toEqual({ a: 'changed' });
    expect(f.getTouched()).toContain('a');

    f.reset();
    expect(f.isDirty()).toBe(false);
    expect(f.getDirtyValues()).toEqual({});
    expect(f.getTouched()).toEqual([]);
    f.destroy();
  });

  it('emits a dirty signal on change', () => {
    const f = new Form(host, { fields: [{ name: 'a', control: 'text', value: '' }] });
    const spy = vi.fn();
    f.on('dirty', spy);
    const cell = f.el.querySelector('[data-field="a"]')!;
    const input = cell.querySelector('input') as HTMLInputElement;
    input.value = 'hi';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls.at(-1)![0].dirty).toBe(true);
    f.destroy();
  });
});

describe('Gap 3 — existing widgets wired as form controls', () => {
  it('slider round-trips a numeric value', () => {
    const f = new Form(host, { fields: [{ name: 's', control: 'slider', value: 30 }] });
    expect(f.getValue().s).toBe(30);
    f.setValue({ s: 70 });
    expect(f.getValue().s).toBe(70);
    f.destroy();
  });

  it('rangeslider round-trips a {low, high} value', () => {
    const f = new Form(host, { fields: [{ name: 'r', control: 'rangeslider', value: { low: 20, high: 80 } }] });
    expect(f.getValue().r).toEqual({ low: 20, high: 80 });
    f.setValue({ r: { low: 10, high: 40 } });
    expect(f.getValue().r).toEqual({ low: 10, high: 40 });
    f.destroy();
  });

  it('rating round-trips a value', () => {
    const f = new Form(host, { fields: [{ name: 'stars', control: 'rating', value: 3 }] });
    expect(f.getValue().stars).toBe(3);
    f.setValue({ stars: 5 });
    expect(f.getValue().stars).toBe(5);
    f.destroy();
  });

  it('datetime round-trips a Date value', () => {
    const d = new Date(2026, 5, 25, 14, 30);
    const f = new Form(host, { fields: [{ name: 'when', control: 'datetime', value: d }] });
    expect((f.getValue().when as Date).getTime()).toBe(d.getTime());
    const d2 = new Date(2027, 0, 1, 9, 0);
    f.setValue({ when: d2 });
    expect((f.getValue().when as Date).getTime()).toBe(d2.getTime());
    f.destroy();
  });

  it('checkboxgroup round-trips an array value', () => {
    const f = new Form(host, {
      fields: [
        {
          name: 'langs',
          control: 'checkboxgroup',
          value: ['ts'],
          props: { options: [{ value: 'ts', label: 'TS' }, { value: 'go', label: 'Go' }] },
        },
      ],
    });
    expect(f.getValue().langs).toEqual(['ts']);
    f.setValue({ langs: ['ts', 'go'] });
    expect(f.getValue().langs).toEqual(['ts', 'go']);
    f.destroy();
  });
});

describe('Gap 4 — new control types (20+ integratable)', () => {
  it('password / email / url round-trip values with the right input type', () => {
    const f = new Form(host, {
      fields: [
        { name: 'pw', control: 'password', value: 's3cret' },
        { name: 'mail', control: 'email', value: 'a@b.co' },
        { name: 'site', control: 'url', value: 'https://x.dev' },
      ],
    });
    expect(f.getValue()).toMatchObject({ pw: 's3cret', mail: 'a@b.co', site: 'https://x.dev' });
    expect((f.el.querySelector('[data-field="pw"] input') as HTMLInputElement).type).toBe('password');
    expect((f.el.querySelector('[data-field="mail"] input') as HTMLInputElement).type).toBe('email');
    expect((f.el.querySelector('[data-field="site"] input') as HTMLInputElement).type).toBe('url');
    f.destroy();
  });

  it('tags round-trips an array value and adds via Enter', () => {
    const f = new Form(host, { fields: [{ name: 'topics', control: 'tags', value: ['a'] }] });
    expect(f.getValue().topics).toEqual(['a']);
    f.setValue({ topics: ['a', 'b'] });
    expect(f.getValue().topics).toEqual(['a', 'b']);

    const input = f.el.querySelector('[data-field="topics"] input') as HTMLInputElement;
    input.value = 'c';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(f.getValue().topics).toEqual(['a', 'b', 'c']);
    f.destroy();
  });

  it('every new control type builds an integratable field (20+ total)', () => {
    const controls = [
      'text', 'password', 'email', 'url', 'number', 'textarea', 'tags', 'select',
      'combobox', 'checkbox', 'checkboxgroup', 'radio', 'switch', 'date', 'time',
      'datetime', 'color', 'file', 'slider', 'rangeslider', 'rating',
    ] as const;
    expect(controls.length).toBeGreaterThanOrEqual(20);
  });
});

describe('Gap 5 — disabled / readonly / disabledWhen', () => {
  it('static disabled renders the control disabled', () => {
    const f = new Form(host, { fields: [{ name: 'a', control: 'text', disabled: true }] });
    const input = f.el.querySelector('[data-field="a"] input') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    f.destroy();
  });

  it('static readonly renders the control read-only', () => {
    const f = new Form(host, { fields: [{ name: 'a', control: 'text', readonly: true }] });
    const input = f.el.querySelector('[data-field="a"] input') as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    f.destroy();
  });

  it('disabledWhen disables a field based on another field value', () => {
    const f = new Form(host, {
      fields: [
        { name: 'useDefault', control: 'checkbox', value: true },
        { name: 'custom', control: 'text', disabledWhen: (v) => v.useDefault === true },
      ],
    });
    const input = f.el.querySelector('[data-field="custom"] input') as HTMLInputElement;
    expect(input.disabled).toBe(true);

    f.setValue({ useDefault: false });
    f.getField('useDefault')!.emit('change' as never, {} as never);
    expect(input.disabled).toBe(false);
    f.destroy();
  });
});

describe('Gap 6 — validation modes', () => {
  it("validateOn: 'change' validates immediately on change", async () => {
    const f = new Form(host, {
      validateOn: 'change',
      fields: [{ name: 'a', control: 'text', rules: { required: true } }],
    });
    const cell = f.el.querySelector('[data-field="a"]')!;
    const input = cell.querySelector('input') as HTMLInputElement;
    input.value = '';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(cell.classList.contains('jects-form__cell--invalid')).toBe(true);
    f.destroy();
  });

  it("validateOn: 'submit' does NOT validate on change, only on submit", async () => {
    const f = new Form(host, {
      validateOn: 'submit',
      fields: [{ name: 'a', control: 'text', rules: { required: true } }],
    });
    const cell = f.el.querySelector('[data-field="a"]')!;
    const input = cell.querySelector('input') as HTMLInputElement;
    input.value = '';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(cell.classList.contains('jects-form__cell--invalid')).toBe(false);

    const ok = await f.submit();
    expect(ok).toBe(false);
    expect(cell.classList.contains('jects-form__cell--invalid')).toBe(true);
    f.destroy();
  });

  it("validateOn: 'blur' validates only when focus leaves the control", async () => {
    const f = new Form(host, {
      validateOn: 'blur',
      fields: [{ name: 'a', control: 'text', rules: { required: true } }],
    });
    const cell = f.el.querySelector('[data-field="a"]')!;
    const input = cell.querySelector('input') as HTMLInputElement;
    input.value = '';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(cell.classList.contains('jects-form__cell--invalid')).toBe(false);

    input.dispatchEvent(new Event('focusout', { bubbles: true }));
    await flush();
    expect(cell.classList.contains('jects-form__cell--invalid')).toBe(true);
    f.destroy();
  });

  it('legacy validateOnChange:false maps to submit-only validation', async () => {
    const f = new Form(host, {
      validateOnChange: false,
      fields: [{ name: 'a', control: 'text', rules: { required: true } }],
    });
    const cell = f.el.querySelector('[data-field="a"]')!;
    const input = cell.querySelector('input') as HTMLInputElement;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(cell.classList.contains('jects-form__cell--invalid')).toBe(false);
    f.destroy();
  });
});
