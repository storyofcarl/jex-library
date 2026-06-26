/**
 * FormulaBar — the name box (A1 address) + formula input above the grid. Reflects
 * the active cell's raw formula/value and commits edits back. Token-pure CSS,
 * accessible labels.
 */

import { Widget, type WidgetConfig, type WidgetEvents, createEl } from '@jects/core';

export interface FormulaBarConfig extends WidgetConfig {
  /** Initial name-box text (e.g. "A1"). */
  name?: string;
  /** Initial formula/value text. */
  value?: string;
}

export interface FormulaBarEvents extends WidgetEvents {
  /** The formula input committed (Enter / blur). */
  commit: { value: string };
  /** Editing was cancelled (Escape). */
  cancel: Record<string, never>;
  /** Live keystrokes in the formula input. */
  input: { value: string };
  /** The name box committed a new address (e.g. "B12"). */
  navigate: { name: string };
}

export class FormulaBar extends Widget<FormulaBarConfig, FormulaBarEvents> {
  private declare nameBox: HTMLInputElement;
  private declare formulaInput: HTMLInputElement;

  protected buildEl(): HTMLElement {
    const root = createEl('div', {
      className: 'jects-fbar',
      attrs: { role: 'group', 'aria-label': 'Formula bar' },
    });

    this.nameBox = createEl('input', {
      className: 'jects-fbar__name',
      attrs: { type: 'text', 'aria-label': 'Name box (cell address)', spellcheck: 'false' },
    });
    const fx = createEl('span', {
      className: 'jects-fbar__fx',
      text: 'fx',
      attrs: { 'aria-hidden': 'true' },
    });
    this.formulaInput = createEl('input', {
      className: 'jects-fbar__input',
      attrs: { type: 'text', 'aria-label': 'Formula input', spellcheck: 'false' },
    });

    this.nameBox.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.emit('navigate', { name: this.nameBox.value.trim() });
      }
    });
    this.formulaInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.emit('commit', { value: this.formulaInput.value });
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.emit('cancel', {});
      }
    });
    this.formulaInput.addEventListener('input', () => {
      this.emit('input', { value: this.formulaInput.value });
    });
    this.formulaInput.addEventListener('blur', () => {
      this.emit('commit', { value: this.formulaInput.value });
    });

    root.append(this.nameBox, fx, this.formulaInput);
    return root;
  }

  protected override render(): void {
    if (this.nameBox && document.activeElement !== this.nameBox) {
      this.nameBox.value = this.config.name ?? '';
    }
    if (this.formulaInput && document.activeElement !== this.formulaInput) {
      this.formulaInput.value = this.config.value ?? '';
    }
  }

  /** Sync the name box + formula text (without stealing focus). */
  setActive(name: string, value: string): void {
    this.update({ name, value });
  }

  /** Focus the formula input (e.g. user clicked it). */
  focusFormula(): void {
    this.formulaInput.focus();
  }

  /** The current formula text. */
  getValue(): string {
    return this.formulaInput?.value ?? '';
  }
}
