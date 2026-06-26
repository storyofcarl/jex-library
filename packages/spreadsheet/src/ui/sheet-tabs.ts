/**
 * SheetTabs — the bottom tab strip: switch / add / rename / reorder / delete
 * sheets. Driven through `SpreadsheetApi`; emits intent events the parent
 * Spreadsheet widget turns into API calls. Token-pure CSS, tablist a11y roles.
 */

import { Widget, type WidgetConfig, type WidgetEvents, createEl } from '@jects/core';
import type { SpreadsheetApi } from '../contract.js';

export interface SheetTabsConfig extends WidgetConfig {
  /** The driving API. Required. */
  api: SpreadsheetApi;
}

export interface SheetTabsEvents extends WidgetEvents {
  /** A tab was activated. */
  activate: { sheetId: string };
  /** The add-sheet button was pressed. */
  add: Record<string, never>;
  /** A sheet was renamed inline. */
  rename: { sheetId: string; name: string };
  /** A sheet delete was requested. */
  remove: { sheetId: string };
  /** A sheet was dragged to a new index. */
  reorder: { sheetId: string; toIndex: number };
}

export class SheetTabs extends Widget<SheetTabsConfig, SheetTabsEvents> {
  private declare stripEl: HTMLElement;
  private declare dragId: string | null;

  protected buildEl(): HTMLElement {
    this.dragId = null;
    // The root is a generic group (not a tablist) so the add button is allowed
    // as a child; the actual `tablist` is the strip, whose children are all tabs
    // (`aria-required-children`).
    const root = createEl('div', {
      className: 'jects-stabs',
      attrs: { role: 'group', 'aria-label': 'Sheets' },
    });
    const addBtn = createEl('button', {
      className: 'jects-stabs__add',
      text: '+',
      attrs: { type: 'button', 'aria-label': 'Add sheet', title: 'Add sheet' },
    });
    addBtn.addEventListener('click', () => this.emit('add', {}));
    this.stripEl = createEl('div', {
      className: 'jects-stabs__strip',
      attrs: { role: 'tablist', 'aria-label': 'Sheets' },
    });
    root.append(addBtn, this.stripEl);
    return root;
  }

  protected override render(): void {
    if (!this.stripEl) return;
    const wb = this.config.api.getWorkbook();
    const activeId = this.config.api.getActiveSheet().id;
    this.stripEl.textContent = '';
    wb.sheets.forEach((sheet, index) => {
      if (sheet.hidden) return;
      const tab = createEl('div', {
        className: [
          'jects-stabs__tab',
          sheet.id === activeId ? 'jects-stabs__tab--active' : '',
        ],
        attrs: {
          role: 'tab',
          tabindex: sheet.id === activeId ? '0' : '-1',
          'aria-selected': sheet.id === activeId ? 'true' : 'false',
          'data-sheet': sheet.id,
          draggable: 'true',
        },
      });
      if (sheet.tabColorToken) {
        tab.style.borderBottomColor = `oklch(var(${sheet.tabColorToken}))`;
      }
      const label = createEl('span', { className: 'jects-stabs__label', text: sheet.name });
      tab.appendChild(label);

      // The delete affordance is a non-interactive, aria-hidden glyph so it does
      // not nest an interactive control inside the `role=tab` (nested-interactive).
      // Keyboard users delete via the tab's own Delete/Backspace handler below.
      const close = createEl('span', {
        className: 'jects-stabs__close',
        text: '×',
        attrs: { 'aria-hidden': 'true' },
      });
      close.addEventListener('click', (e) => {
        // Stop the bubble so the tab's own click (activate) does not also fire.
        e.stopPropagation();
        this.emit('remove', { sheetId: sheet.id });
      });
      tab.appendChild(close);

      tab.addEventListener('click', () => this.emit('activate', { sheetId: sheet.id }));
      tab.addEventListener('dblclick', () => this.beginRename(tab, label, sheet.id, sheet.name));
      tab.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.emit('activate', { sheetId: sheet.id });
        } else if (e.key === 'F2') {
          e.preventDefault();
          this.beginRename(tab, label, sheet.id, sheet.name);
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          this.emit('remove', { sheetId: sheet.id });
        }
      });

      // drag-reorder
      tab.addEventListener('dragstart', () => {
        this.dragId = sheet.id;
      });
      tab.addEventListener('dragover', (e) => e.preventDefault());
      tab.addEventListener('drop', (e) => {
        e.preventDefault();
        if (this.dragId && this.dragId !== sheet.id) {
          this.emit('reorder', { sheetId: this.dragId, toIndex: index });
        }
        this.dragId = null;
      });

      this.stripEl.appendChild(tab);
    });
  }

  private beginRename(_tab: HTMLElement, label: HTMLElement, sheetId: string, current: string): void {
    const input = createEl('input', {
      className: 'jects-stabs__rename',
      attrs: { type: 'text', 'aria-label': 'Rename sheet' },
    });
    input.value = current;
    label.replaceWith(input);
    input.focus();
    input.select();
    const finish = (commit: boolean): void => {
      const name = input.value.trim();
      if (commit && name && name !== current) {
        this.emit('rename', { sheetId, name });
      } else {
        this.render();
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  }
}
