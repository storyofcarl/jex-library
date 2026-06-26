/** jsdom unit test for data validation. */
import { describe, it, expect } from 'vitest';
import { validate, ValidationStore } from './validation.js';

describe('validate', () => {
  it('validates list membership', () => {
    const rule = { kind: 'list', values: ['Yes', 'No'] } as const;
    expect(validate(rule, 'Yes').valid).toBe(true);
    expect(validate(rule, 'Maybe').valid).toBe(false);
  });

  it('validates number bounds', () => {
    const rule = { kind: 'number', min: 0, max: 100 } as const;
    expect(validate(rule, 50).valid).toBe(true);
    expect(validate(rule, -1).valid).toBe(false);
    expect(validate(rule, 200).valid).toBe(false);
    expect(validate(rule, 'nope').valid).toBe(false);
  });

  it('validates text length', () => {
    const rule = { kind: 'text', maxLength: 3 } as const;
    expect(validate(rule, 'abc').valid).toBe(true);
    expect(validate(rule, 'abcd').valid).toBe(false);
  });

  it('honors allowBlank', () => {
    expect(validate({ kind: 'number', allowBlank: false }, null).valid).toBe(false);
    expect(validate({ kind: 'number' }, null).valid).toBe(true);
  });
});

describe('ValidationStore', () => {
  it('stores and retrieves rules by cell', () => {
    const store = new ValidationStore();
    store.set('sheet-1', 0, 0, { kind: 'list', values: ['A'] });
    expect(store.get('sheet-1', 0, 0)?.kind).toBe('list');
    expect(store.get('sheet-1', 1, 1)).toBeUndefined();
    store.remove('sheet-1', 0, 0);
    expect(store.get('sheet-1', 0, 0)).toBeUndefined();
  });
});
