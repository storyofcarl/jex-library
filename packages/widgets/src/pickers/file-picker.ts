/**
 * FilePicker (Vault) — a drag-and-drop file selection zone with a managed file list.
 *
 * Anatomy:
 *  - a drop zone (also a button) hosting a hidden native <input type="file">
 *  - a file list: each row shows name, size, a progress bar, and a remove button
 *
 * Config: accept / multiple / maxSize / disabled.
 * Events: `beforeAdd` (vetoable), `add`, `remove`, `progress`, `error`, `change`.
 *
 * IMPORTANT (matches the Button reference): with `useDefineForClassFields`, subclass
 * instance fields are (re)initialised AFTER `super()` runs `buildEl()` + `render()`,
 * which would wipe any DOM refs / state stored on fields. So this class keeps NO
 * surviving instance fields: DOM nodes are queried from `this.el`, and the file list
 * + drag state live in a small state object stashed on the root element.
 */

import { Widget, type WidgetConfig, type WidgetEvents, createEl, register } from '@jects/core';

export interface FilePickerConfig extends WidgetConfig {
  /** Accept filter, mirrors the native input `accept` (e.g. `image/*,.pdf`). */
  accept?: string;
  /** Allow selecting multiple files. Default `true`. */
  multiple?: boolean;
  /** Max size per file in bytes. Files larger are rejected with an `error` event. */
  maxSize?: number;
  /** Disable interaction. */
  disabled?: boolean;
  /** Primary drop-zone label. */
  label?: string;
  /** Secondary hint under the label. */
  hint?: string;
  /** Convenience change handler with the current file list. */
  onChange?: (files: VaultFile[]) => void;
}

/** A tracked entry in the file list. */
export interface VaultFile {
  /** Stable id within this picker. */
  id: string;
  /** The underlying File (when chosen via input/drop). */
  file: File;
  name: string;
  size: number;
  /** Upload progress 0..100. */
  progress: number;
}

export interface FilePickerEvents extends WidgetEvents {
  /** Vetoable per file: return `false` to reject before it is added. */
  beforeAdd: { file: File; picker: FilePicker };
  add: { entry: VaultFile; picker: FilePicker };
  remove: { entry: VaultFile; picker: FilePicker };
  progress: { entry: VaultFile; progress: number; picker: FilePicker };
  error: { file: File; reason: 'maxSize' | 'accept'; picker: FilePicker };
  change: { files: VaultFile[]; picker: FilePicker };
}

interface VaultState {
  entries: VaultFile[];
  dragDepth: number;
}

let fileSeq = 0;

type StatefulEl = HTMLElement & { _jectsVault?: VaultState };

export class FilePicker extends Widget<FilePickerConfig, FilePickerEvents> {
  protected override defaults(): Partial<FilePickerConfig> {
    return {
      multiple: true,
      label: 'Drop files here or click to browse',
      hint: '',
    };
  }

  /** Per-instance state, stashed on the root element so it survives field init. */
  private get state(): VaultState {
    const el = this.el as StatefulEl;
    if (!el._jectsVault) el._jectsVault = { entries: [], dragDepth: 0 };
    return el._jectsVault;
  }

  // ---- DOM ref accessors (queried, never stored on fields) -----------------
  private get zone(): HTMLElement {
    return this.el.querySelector('.jects-filepicker__zone') as HTMLElement;
  }
  private get input(): HTMLInputElement {
    return this.el.querySelector('.jects-filepicker__input') as HTMLInputElement;
  }
  private get listEl(): HTMLUListElement {
    return this.el.querySelector('.jects-filepicker__list') as HTMLUListElement;
  }
  private get labelEl(): HTMLElement {
    return this.el.querySelector('.jects-filepicker__label') as HTMLElement;
  }
  private get hintEl(): HTMLElement {
    return this.el.querySelector('.jects-filepicker__hint') as HTMLElement;
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', { className: 'jects-filepicker' });

    // ----- drop zone (button semantics) -----
    const zone = createEl('div', {
      className: 'jects-filepicker__zone',
      attrs: { role: 'button', tabindex: '0', 'aria-label': 'Add files' },
    });
    const labelEl = createEl('span', { className: 'jects-filepicker__label' });
    const hintEl = createEl('span', { className: 'jects-filepicker__hint' });
    const icon = createEl('span', {
      className: 'jects-filepicker__zone-icon',
      attrs: { 'aria-hidden': 'true' },
      html: uploadIcon(),
    });

    // hidden native input
    const input = createEl('input', {
      className: 'jects-filepicker__input',
      attrs: { type: 'file', hidden: '' },
    });
    input.addEventListener('change', () => this.onInputChange());

    zone.append(icon, labelEl, hintEl, input);
    zone.addEventListener('click', () => this.openDialog());
    zone.addEventListener('keydown', (e) => this.onZoneKeyDown(e as KeyboardEvent));
    zone.addEventListener('dragenter', (e) => this.onDragEnter(e as DragEvent));
    zone.addEventListener('dragover', (e) => this.onDragOver(e as DragEvent));
    zone.addEventListener('dragleave', (e) => this.onDragLeave(e as DragEvent));
    zone.addEventListener('drop', (e) => this.onDrop(e as DragEvent));

    // ----- file list -----
    const listEl = createEl('ul', {
      className: 'jects-filepicker__list',
      attrs: { 'aria-label': 'Selected files' },
    });
    // Delegated remove-button handling. Wired directly here (not via on2) because
    // `this.el` is not yet assigned during buildEl(); listEl is a local ref.
    listEl.addEventListener('click', (e) => {
      const target = (e.target as Element | null)?.closest('.jects-filepicker__remove');
      const id = target?.getAttribute('data-id');
      if (id) this.remove(id);
    });

    root.append(zone, listEl);
    return root;
  }

  // ---- interaction --------------------------------------------------------

  private openDialog(): void {
    if (this.config.disabled) return;
    this.input.click();
  }

  private onZoneKeyDown(e: KeyboardEvent): void {
    if (this.config.disabled) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.openDialog();
    }
  }

  private onInputChange(): void {
    const input = this.input;
    if (input.files) this.ingest(input.files);
    // allow re-selecting the same file later
    input.value = '';
  }

  private onDragEnter(e: DragEvent): void {
    if (this.config.disabled) return;
    e.preventDefault();
    this.state.dragDepth++;
    this.zone.classList.add('jects-filepicker__zone--dragover');
  }

  private onDragOver(e: DragEvent): void {
    if (this.config.disabled) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }

  private onDragLeave(e: DragEvent): void {
    if (this.config.disabled) return;
    e.preventDefault();
    const st = this.state;
    st.dragDepth = Math.max(0, st.dragDepth - 1);
    if (st.dragDepth === 0) this.zone.classList.remove('jects-filepicker__zone--dragover');
  }

  private onDrop(e: DragEvent): void {
    if (this.config.disabled) return;
    e.preventDefault();
    this.state.dragDepth = 0;
    this.zone.classList.remove('jects-filepicker__zone--dragover');
    if (e.dataTransfer?.files) this.ingest(e.dataTransfer.files);
  }

  // ---- ingestion / list management ---------------------------------------

  private ingest(list: FileList): void {
    const files = Array.from(list);
    const single = this.config.multiple === false;
    const toAdd = single ? files.slice(0, 1) : files;
    if (single) this.clear(false);
    let added = false;
    for (const file of toAdd) {
      if (this.addFile(file)) added = true;
    }
    if (added) this.emitChange();
  }

  /** Validate + add a single File. Returns true if it was added. */
  private addFile(file: File): boolean {
    if (!this.acceptsType(file)) {
      this.emit('error', { file, reason: 'accept', picker: this });
      return false;
    }
    if (this.config.maxSize != null && file.size > this.config.maxSize) {
      this.emit('error', { file, reason: 'maxSize', picker: this });
      return false;
    }
    if (this.emit('beforeAdd', { file, picker: this }) === false) return false;

    const entry: VaultFile = {
      id: `vault-${++fileSeq}`,
      file,
      name: file.name,
      size: file.size,
      progress: 0,
    };
    this.state.entries.push(entry);
    this.renderList();
    this.emit('add', { entry, picker: this });
    return true;
  }

  private acceptsType(file: File): boolean {
    const accept = this.config.accept?.trim();
    if (!accept) return true;
    const patterns = accept
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const name = file.name.toLowerCase();
    const type = (file.type || '').toLowerCase();
    return patterns.some((p) => {
      if (p.startsWith('.')) return name.endsWith(p);
      if (p.endsWith('/*')) return type.startsWith(p.slice(0, -1));
      return type === p;
    });
  }

  /** Remove an entry by id. */
  remove(id: string): this {
    const entries = this.state.entries;
    const idx = entries.findIndex((e) => e.id === id);
    if (idx === -1) return this;
    const [entry] = entries.splice(idx, 1);
    this.renderList();
    this.emit('remove', { entry: entry!, picker: this });
    this.emitChange();
    return this;
  }

  /** Update the upload progress (0..100) for an entry. */
  setProgress(id: string, progress: number): this {
    const entry = this.state.entries.find((e) => e.id === id);
    if (!entry) return this;
    entry.progress = Math.max(0, Math.min(100, progress));
    this.updateProgressDom(entry);
    this.emit('progress', { entry, progress: entry.progress, picker: this });
    return this;
  }

  /** Remove all entries. */
  clear(emit = true): this {
    if (this.state.entries.length === 0) return this;
    this.state.entries = [];
    this.renderList();
    if (emit) this.emitChange();
    return this;
  }

  /** Current file entries (read-only snapshot). */
  getFiles(): readonly VaultFile[] {
    return this.state.entries.slice();
  }

  private emitChange(): void {
    const files = this.state.entries.slice();
    this.config.onChange?.(files);
    this.emit('change', { files, picker: this });
  }

  // ---- rendering ----------------------------------------------------------

  protected override render(): void {
    const {
      accept,
      multiple = true,
      disabled = false,
      label = 'Drop files here or click to browse',
      hint = '',
    } = this.config;

    this.el.classList.toggle('jects-filepicker--disabled', disabled);
    const zone = this.zone;
    zone.setAttribute('aria-disabled', String(disabled));
    zone.tabIndex = disabled ? -1 : 0;

    const input = this.input;
    if (accept) input.setAttribute('accept', accept);
    else input.removeAttribute('accept');
    input.toggleAttribute('multiple', multiple !== false);

    this.labelEl.textContent = label;
    const hintEl = this.hintEl;
    hintEl.textContent = hint;
    hintEl.hidden = !hint;

    this.renderList();
  }

  private renderList(): void {
    const listEl = this.listEl;
    // jects-safe-html: empty clear; rows built below as DOM nodes
    listEl.innerHTML = '';
    const entries = this.state.entries;
    listEl.hidden = entries.length === 0;
    for (const entry of entries) {
      listEl.append(this.buildRow(entry));
    }
  }

  private buildRow(entry: VaultFile): HTMLLIElement {
    const row = createEl('li', {
      className: 'jects-filepicker__item',
      dataset: { id: entry.id },
    });

    const info = createEl('div', { className: 'jects-filepicker__item-info' });
    info.append(
      createEl('span', {
        className: 'jects-filepicker__item-name',
        text: entry.name,
        attrs: { title: entry.name },
      }),
      createEl('span', { className: 'jects-filepicker__item-size', text: formatBytes(entry.size) }),
    );

    const progressWrap = createEl('div', {
      className: 'jects-filepicker__progress',
      attrs: {
        role: 'progressbar',
        'aria-label': `Upload progress for ${entry.name}`,
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': String(Math.round(entry.progress)),
      },
    });
    const bar = createEl('div', { className: 'jects-filepicker__progress-bar' });
    bar.style.width = `${entry.progress}%`;
    progressWrap.append(bar);

    const remove = createEl('button', {
      className: 'jects-filepicker__remove',
      text: '×',
      attrs: { type: 'button', 'aria-label': `Remove ${entry.name}`, 'data-id': entry.id },
    });

    row.append(info, progressWrap, remove);
    return row;
  }

  private updateProgressDom(entry: VaultFile): void {
    const row = this.listEl.querySelector(`[data-id="${entry.id}"]`);
    if (!row) return;
    const wrap = row.querySelector('.jects-filepicker__progress');
    const bar = row.querySelector<HTMLElement>('.jects-filepicker__progress-bar');
    if (bar) bar.style.width = `${entry.progress}%`;
    if (wrap) wrap.setAttribute('aria-valuenow', String(Math.round(entry.progress)));
  }
}

// ---- helpers --------------------------------------------------------------

/** Human-readable byte size. */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  const rounded = i === 0 ? value : Math.round(value * 10) / 10;
  return `${rounded} ${units[i]}`;
}

function uploadIcon(): string {
  return (
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
    '<polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>'
  );
}

register(
  'filepicker',
  FilePicker as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => FilePicker,
);
