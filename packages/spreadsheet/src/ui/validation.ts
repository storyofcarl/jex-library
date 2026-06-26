/**
 * Data-validation rules attached to cells/ranges. The UI stores rules in a map
 * keyed by `"sheet:row,col"` (kept in the widget, not the engine model, since
 * the frozen contract's `CellModel` has no validation field). Pure validators.
 */

import type { CellValue } from '../contract.js';

/** A validation rule for a cell. */
export type ValidationRule =
  | { kind: 'list'; values: string[]; allowBlank?: boolean }
  | { kind: 'number'; min?: number; max?: number; allowBlank?: boolean }
  | { kind: 'text'; maxLength?: number; allowBlank?: boolean };

/** Result of validating a value against a rule. */
export interface ValidationResult {
  valid: boolean;
  message?: string;
}

/** Validate a raw input string against a rule. */
export function validate(rule: ValidationRule, value: CellValue): ValidationResult {
  const isBlank = value === null || value === '' || value === undefined;
  if (isBlank) {
    return rule.allowBlank === false
      ? { valid: false, message: 'Value is required' }
      : { valid: true };
  }
  switch (rule.kind) {
    case 'list': {
      const s = String(value);
      return rule.values.includes(s)
        ? { valid: true }
        : { valid: false, message: `Must be one of: ${rule.values.join(', ')}` };
    }
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      if (Number.isNaN(n)) return { valid: false, message: 'Must be a number' };
      if (rule.min !== undefined && n < rule.min) return { valid: false, message: `Min ${rule.min}` };
      if (rule.max !== undefined && n > rule.max) return { valid: false, message: `Max ${rule.max}` };
      return { valid: true };
    }
    case 'text': {
      const s = String(value);
      if (rule.maxLength !== undefined && s.length > rule.maxLength) {
        return { valid: false, message: `Max length ${rule.maxLength}` };
      }
      return { valid: true };
    }
  }
}

/** A registry of validation rules keyed by `"sheetId:row,col"`. */
export class ValidationStore {
  private rules = new Map<string, ValidationRule>();

  private key(sheet: string, row: number, col: number): string {
    return `${sheet}:${row},${col}`;
  }

  set(sheet: string, row: number, col: number, rule: ValidationRule): void {
    this.rules.set(this.key(sheet, row, col), rule);
  }

  get(sheet: string, row: number, col: number): ValidationRule | undefined {
    return this.rules.get(this.key(sheet, row, col));
  }

  remove(sheet: string, row: number, col: number): void {
    this.rules.delete(this.key(sheet, row, col));
  }

  clear(): void {
    this.rules.clear();
  }
}
