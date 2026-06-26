/**
 * RichText — a contenteditable WYSIWYG editor.
 *
 * A toolbar of formatting commands (bold/italic/underline/strike, headings,
 * ordered/unordered lists, link, blockquote, code, undo/redo, clear formatting,
 * text-align) drives an editable region. Commands run through a small command
 * layer (`document.execCommand` when present, with a Selection/Range fallback so
 * the component degrades gracefully where execCommand is missing).
 *
 * Public surface: `getHTML()`/`setHTML(html)`/`getMarkdown()`, vetoable
 * `beforeChange` then `change`/`input` events, and keyboard shortcuts
 * (Ctrl/Cmd+B/I/U, Ctrl+Z / Ctrl+Shift+Z).
 *
 * Pasted HTML is sanitized to an allow-list before insertion.
 *
 * Self-contained: depends only on `@jects/core`.
 *
 * NOTE: `super()` runs `buildEl()` before subclass field initializers, so all
 * DOM listeners are wired with bound methods inside `buildEl()`, never via
 * class-field arrows (which would still be `undefined` at that point).
 */

import {
  Widget,
  type WidgetConfig,
  type WidgetEvents,
  createEl,
  register,
  sanitizeHtml as coreSanitizeHtml,
  escape as coreEscape,
} from '@jects/core';

/** Built-in toolbar command identifiers. */
export type RichTextCommand =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'paragraph'
  | 'ul'
  | 'ol'
  | 'blockquote'
  | 'code'
  | 'link'
  | 'unlink'
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight'
  | 'indent'
  | 'outdent'
  | 'fontFamily'
  | 'fontSize'
  | 'foreColor'
  | 'backColor'
  | 'insertImage'
  | 'insertTable'
  | 'tableAddRow'
  | 'tableAddColumn'
  | 'tableDeleteRow'
  | 'tableDeleteColumn'
  | 'sourceView'
  | 'undo'
  | 'redo'
  | 'clear';

/** A toolbar item: a known command or a separator. */
export type RichTextToolbarItem = RichTextCommand | 'separator';

export interface RichTextConfig extends WidgetConfig {
  /** Initial HTML content of the editor. */
  value?: string;
  /** Placeholder shown when the editor is empty. */
  placeholder?: string;
  /** Read-only: editable region is non-editable and the toolbar is disabled. */
  readOnly?: boolean;
  /** Disabled state (non-editable, dimmed). */
  disabled?: boolean;
  /** Accessible name for the editable region. Default `Rich text editor`. */
  label?: string;
  /**
   * Toolbar layout. Defaults to a full set. Use `'separator'` between groups.
   * Pass `[]` to hide the toolbar entirely.
   */
  toolbar?: RichTextToolbarItem[];
  /** Minimum editor height (CSS length). Default `8rem`. */
  minHeight?: string;
  /**
   * Sanitize pasted HTML to the editor's allow-list (strip scripts/styles/
   * `class` cruft, unwrap non-semantic wrappers). Default `true`.
   */
  pasteClean?: boolean;
  /** Start in raw-HTML source view rather than the WYSIWYG surface. Default `false`. */
  sourceView?: boolean;
  /** Options for the font-family select (CSS font stacks). Falls back to a built-in list. */
  fontFamilies?: string[];
  /** Options for the font-size select (CSS lengths, e.g. `'14px'`). Falls back to a built-in list. */
  fontSizes?: string[];
}

export interface RichTextEvents extends WidgetEvents {
  /** Vetoable: return `false` to cancel a content-changing command/input. */
  beforeChange: { editor: RichText; html: string };
  /** Fired after the content changed (command or typing). */
  change: { editor: RichText; html: string };
  /** Fired on every input into the editable region. */
  input: { editor: RichText; html: string };
  /** Editable region gained focus. */
  focus: { editor: RichText };
  /** Editable region lost focus. */
  blur: { editor: RichText };
}

const DEFAULT_TOOLBAR: RichTextToolbarItem[] = [
  'bold',
  'italic',
  'underline',
  'strike',
  'separator',
  'h1',
  'h2',
  'h3',
  'paragraph',
  'separator',
  'ul',
  'ol',
  'blockquote',
  'code',
  'separator',
  'link',
  'unlink',
  'separator',
  'alignLeft',
  'alignCenter',
  'alignRight',
  'indent',
  'outdent',
  'separator',
  'fontFamily',
  'fontSize',
  'foreColor',
  'backColor',
  'separator',
  'insertImage',
  'insertTable',
  'separator',
  'sourceView',
  'undo',
  'redo',
  'clear',
];

/** Default font-family stacks offered by the `fontFamily` toolbar select. */
const DEFAULT_FONT_FAMILIES = [
  'Inherit',
  'Arial, sans-serif',
  'Georgia, serif',
  '"Times New Roman", serif',
  '"Courier New", monospace',
  '"Comic Sans MS", cursive',
];

/** Default font sizes offered by the `fontSize` toolbar select. */
const DEFAULT_FONT_SIZES = ['12px', '14px', '16px', '18px', '24px', '32px'];

interface CommandSpec {
  /** Short visible glyph/label for the toolbar button. */
  label: string;
  /** Accessible name / tooltip. */
  title: string;
  /** Keyboard hint appended to the title (display only). */
  shortcut?: string;
}

const COMMANDS: Record<RichTextCommand, CommandSpec> = {
  bold: { label: 'B', title: 'Bold', shortcut: 'Ctrl+B' },
  italic: { label: 'I', title: 'Italic', shortcut: 'Ctrl+I' },
  underline: { label: 'U', title: 'Underline', shortcut: 'Ctrl+U' },
  strike: { label: 'S', title: 'Strikethrough' },
  h1: { label: 'H1', title: 'Heading 1' },
  h2: { label: 'H2', title: 'Heading 2' },
  h3: { label: 'H3', title: 'Heading 3' },
  paragraph: { label: 'P', title: 'Paragraph' },
  ul: { label: '• List', title: 'Bulleted list' },
  ol: { label: '1. List', title: 'Numbered list' },
  blockquote: { label: '“', title: 'Blockquote' },
  code: { label: '</>', title: 'Code block' },
  link: { label: 'Link', title: 'Insert link', shortcut: 'Ctrl+K' },
  unlink: { label: 'Unlink', title: 'Remove link' },
  alignLeft: { label: 'L', title: 'Align left' },
  alignCenter: { label: 'C', title: 'Align center' },
  alignRight: { label: 'R', title: 'Align right' },
  indent: { label: '⇥', title: 'Increase indent' },
  outdent: { label: '⇤', title: 'Decrease indent' },
  fontFamily: { label: 'Font', title: 'Font family' },
  fontSize: { label: 'Size', title: 'Font size' },
  foreColor: { label: 'A', title: 'Text color' },
  backColor: { label: 'A', title: 'Highlight color' },
  insertImage: { label: 'Img', title: 'Insert image' },
  insertTable: { label: 'Table', title: 'Insert table' },
  tableAddRow: { label: '+Row', title: 'Insert row below' },
  tableAddColumn: { label: '+Col', title: 'Insert column after' },
  tableDeleteRow: { label: '−Row', title: 'Delete row' },
  tableDeleteColumn: { label: '−Col', title: 'Delete column' },
  sourceView: { label: '<>', title: 'Toggle HTML source' },
  undo: { label: '↶', title: 'Undo', shortcut: 'Ctrl+Z' },
  redo: { label: '↷', title: 'Redo', shortcut: 'Ctrl+Shift+Z' },
  clear: { label: 'Tx', title: 'Clear formatting' },
};

/**
 * Commands that represent a genuinely toggleable formatting state. Only these
 * carry `aria-pressed` (the ARIA toggle-button semantic). Action buttons
 * (undo/redo/link/unlink/clear, headings, paragraph, blockquote, code) must NOT
 * expose `aria-pressed`, which would falsely advertise toggle state to AT.
 */
const TOGGLE_COMMANDS = new Set<RichTextCommand>([
  'bold',
  'italic',
  'underline',
  'strike',
  'ul',
  'ol',
  'alignLeft',
  'alignCenter',
  'alignRight',
  'sourceView',
]);

/** Commands rendered as a `<select>` rather than a button (value-bearing). */
const SELECT_COMMANDS = new Set<RichTextCommand>(['fontFamily', 'fontSize']);

/** Commands rendered as an `<input type="color">` swatch (value-bearing). */
const COLOR_COMMANDS = new Set<RichTextCommand>(['foreColor', 'backColor']);

/** Block-level tags used when resolving the nearest block for indent/outdent. */
const BLOCK_TAGS = new Set([
  'P',
  'DIV',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'BLOCKQUOTE',
  'PRE',
  'TD',
  'TH',
]);

/** Tags permitted in editor / pasted content. Everything else is stripped. */
const ALLOWED_TAGS = new Set([
  'P',
  'BR',
  'B',
  'STRONG',
  'I',
  'EM',
  'U',
  'S',
  'STRIKE',
  'DEL',
  'A',
  'UL',
  'OL',
  'LI',
  'BLOCKQUOTE',
  'PRE',
  'CODE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'SPAN',
  'DIV',
  'IMG',
  'TABLE',
  'THEAD',
  'TBODY',
  'TFOOT',
  'TR',
  'TD',
  'TH',
  'CAPTION',
  'COLGROUP',
  'COL',
]);

/** Attributes permitted per tag. */
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  A: new Set(['href', 'title', 'target', 'rel']),
  IMG: new Set(['src', 'alt', 'title', 'width', 'height']),
  TD: new Set(['style', 'colspan', 'rowspan']),
  TH: new Set(['style', 'colspan', 'rowspan', 'scope']),
  COL: new Set(['span', 'style']),
  '*': new Set(['style']),
};

/** Only these style declarations survive sanitization (alignment, color, font, indent). */
const ALLOWED_STYLES = new Set([
  'text-align',
  'color',
  'background-color',
  'font-family',
  'font-size',
  'margin-left',
  'padding-left',
]);

export class RichText extends Widget<RichTextConfig, RichTextEvents> {
  // NOTE: with `useDefineForClassFields`, subclass field initializers run AFTER
  // super() (which runs buildEl()+render()) and would clobber anything assigned
  // during construction. So the DOM refs are DERIVED from the root via getters,
  // and the change-gating "last html" is stashed on the root's dataset rather
  // than in a field.

  /** The contenteditable surface (created in buildEl). */
  private get editable(): HTMLElement {
    return this.el.querySelector('.jects-richtext__editable') as HTMLElement;
  }
  /** The toolbar container (created in buildEl). */
  private get toolbarEl(): HTMLElement {
    return this.el.querySelector('.jects-richtext__toolbar') as HTMLElement;
  }
  /** The raw-HTML source textarea (created in buildEl, hidden until toggled). */
  private get sourceEl(): HTMLTextAreaElement {
    return this.el.querySelector('.jects-richtext__source') as HTMLTextAreaElement;
  }

  /**
   * Selection saved when a value-bearing toolbar control (color swatch / font
   * select) is pressed, since focusing the control collapses the editor's
   * selection. Restored before the styling command runs. Declared with an
   * initializer (runs AFTER super(), which never touches it — so no clobber).
   */
  private savedRange: Range | null = null;
  /** Last emitted HTML, used to gate change events (stored on dataset). */
  private get lastHtml(): string {
    return this.el.dataset.lastHtml ?? '';
  }
  private set lastHtml(v: string) {
    this.el.dataset.lastHtml = v;
  }

  protected override defaults(): Partial<RichTextConfig> {
    return {
      value: '',
      placeholder: 'Write something…',
      readOnly: false,
      disabled: false,
      label: 'Rich text editor',
      toolbar: DEFAULT_TOOLBAR,
      minHeight: '8rem',
      pasteClean: true,
      sourceView: false,
      fontFamilies: DEFAULT_FONT_FAMILIES,
      fontSizes: DEFAULT_FONT_SIZES,
    };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', { className: 'jects-richtext' });

    // Toolbar (role=toolbar; buttons added in render()).
    const toolbar = createEl('div', {
      className: 'jects-richtext__toolbar',
      attrs: { role: 'toolbar', 'aria-label': 'Formatting' },
    });

    // Editable region.
    const editable = createEl('div', {
      className: 'jects-richtext__editable',
      attrs: { role: 'textbox', 'aria-multiline': 'true', spellcheck: 'true' },
    });

    // Raw-HTML source surface (sibling of the editable; shown only in source view).
    const source = createEl('textarea', {
      className: 'jects-richtext__source',
      attrs: { spellcheck: 'false', 'aria-label': 'HTML source' },
    });
    source.hidden = true;

    // Wire listeners with bound methods — class-field arrow handlers have NOT
    // initialized yet at buildEl() time, so we must bind methods inline.
    editable.addEventListener('input', () => this.handleInput());
    editable.addEventListener('keydown', (e) => this.handleKeydown(e));
    editable.addEventListener('paste', (e) => this.handlePaste(e as ClipboardEvent));
    editable.addEventListener('focus', () => this.emit('focus', { editor: this }));
    editable.addEventListener('blur', () => this.emit('blur', { editor: this }));

    // Delegated toolbar clicks (mousedown to preserve selection before blur).
    toolbar.addEventListener('mousedown', (e) => this.handleToolbarMouseDown(e));
    toolbar.addEventListener('click', (e) => this.handleToolbarClick(e));
    // Value-bearing controls (font selects, color swatches) commit on change.
    toolbar.addEventListener('change', (e) => this.handleToolbarChange(e));
    // Roving-tabindex keyboard navigation for the ARIA toolbar pattern.
    toolbar.addEventListener('keydown', (e) => this.handleToolbarKeydown(e));

    root.appendChild(toolbar);
    root.appendChild(editable);
    root.appendChild(source);
    return root;
  }

  // ---- listeners (plain methods; bound inline in buildEl) ------------------

  private handleInput(): void {
    this.notifyChange('input');
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (this.config.readOnly || this.config.disabled) return;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) {
      // Non-modifier keys: handle block/inline EXIT gestures so the caret can
      // escape a list / blockquote / code block, and so typing past a link does
      // not extend the anchor. Everything else falls through to native editing.
      if (e.key === 'Enter' && !e.shiftKey) {
        if (this.handleEnterExit(e)) return;
      } else if (isPrintableKey(e)) {
        this.preventLinkBleed();
      }
      return;
    }
    const key = e.key.toLowerCase();
    if (key === 'b') {
      e.preventDefault();
      this.exec('bold');
    } else if (key === 'i') {
      e.preventDefault();
      this.exec('italic');
    } else if (key === 'u') {
      e.preventDefault();
      this.exec('underline');
    } else if (key === 'k') {
      e.preventDefault();
      this.exec('link');
    } else if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.exec('undo');
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      e.preventDefault();
      this.exec('redo');
    }
  }

  private handlePaste(e: ClipboardEvent): void {
    if (this.config.readOnly || this.config.disabled) return;
    // Honor the vetoable beforeChange contract: a handler returning false must
    // be able to block a paste, mirroring exec(). Emit before mutating content.
    if (this.emit('beforeChange', { editor: this, html: this.getHTML() }) === false) {
      e.preventDefault();
      return;
    }
    const data = e.clipboardData;
    if (!data) return;
    e.preventDefault();
    const html = data.getData('text/html');
    const text = data.getData('text/plain');
    if (html) {
      // pasteClean (default on) aggressively strips editor cruft (class/style/
      // non-semantic wrappers) BEFORE the allow-list sanitize that insertHtml
      // always applies for safety.
      const clean = this.config.pasteClean !== false;
      this.insertHtml(clean ? cleanPastedHtml(html) : html);
    } else if (text) {
      this.insertText(text);
    }
    this.notifyChange('change');
  }

  // ---- block / inline exit gestures ---------------------------------------

  /**
   * Enter-key exit handling for block formats. Returns `true` when the gesture
   * was consumed (and `e.preventDefault()` was called) so the caller skips the
   * native behavior; `false` to let the browser insert a normal newline.
   *
   * Rules (match common WYSIWYG editors):
   *  - Enter on an EMPTY list item: leave the list — the empty `<li>` becomes a
   *    paragraph after the list (or, mid-list, splits the list).
   *  - Enter in a blockquote or code block when the caret is at the end of the
   *    block (or the block is empty / a trailing blank line): break OUT into a
   *    fresh paragraph after the block instead of staying inside it.
   */
  private handleEnterExit(e: KeyboardEvent): boolean {
    const sel = this.ownerDoc().getSelection?.();
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    if (!range.collapsed) return false;
    const start = range.startContainer;
    if (!this.editable.contains(start)) return false;

    const li = this.closestWithin(start, 'LI');
    if (li && this.isEmptyBlock(li)) {
      this.exitList(li);
      e.preventDefault();
      return true;
    }

    const block = this.closestWithin(start, 'BLOCKQUOTE') ?? this.closestWithin(start, 'PRE');
    if (block && this.shouldExitBlock(block, range)) {
      this.exitBlock(block);
      e.preventDefault();
      return true;
    }

    return false;
  }

  /** Nearest ancestor element with the given tag, stopping at the editable. */
  private closestWithin(node: Node, tag: string): HTMLElement | null {
    let cur: Node | null = node;
    while (cur && cur !== this.editable) {
      if (cur.nodeType === 1 && (cur as HTMLElement).tagName === tag) {
        return cur as HTMLElement;
      }
      cur = cur.parentNode;
    }
    return null;
  }

  /** True when a block has no meaningful text (ignoring a lone trailing <br>). */
  private isEmptyBlock(el: HTMLElement): boolean {
    return (el.textContent ?? '').trim() === '';
  }

  /**
   * Decide whether Enter in a blockquote/code block should break OUT. Triggers
   * when the block is empty, or the collapsed caret sits at the very END of the
   * block's content (pressing Enter at the end — which also covers a "second
   * Enter" after a trailing blank line, since the caret stays at the end).
   * A caret in the MIDDLE inserts a normal newline (returns false).
   */
  private shouldExitBlock(block: HTMLElement, range: Range): boolean {
    if (this.isEmptyBlock(block)) return true;
    const probe = this.ownerDoc().createRange();
    probe.selectNodeContents(block);
    probe.setStart(range.endContainer, range.endOffset);
    // No remaining text after the caret => caret is at the end of the block.
    return probe.toString().length === 0;
  }

  /** Replace an empty list item with a paragraph after the list. */
  private exitList(li: HTMLElement): void {
    const list = li.parentElement;
    if (!list) return;
    const p = this.ownerDoc().createElement('p');
    p.appendChild(this.ownerDoc().createElement('br'));

    // Items after the empty one move into a new list following the paragraph.
    const trailing: HTMLElement[] = [];
    let sib = li.nextElementSibling;
    while (sib) {
      const next = sib.nextElementSibling;
      trailing.push(sib as HTMLElement);
      sib = next;
    }

    list.parentNode?.insertBefore(p, list.nextSibling);
    if (trailing.length > 0) {
      const tail = list.cloneNode(false) as HTMLElement;
      for (const item of trailing) tail.appendChild(item);
      list.parentNode?.insertBefore(tail, p.nextSibling);
    }
    li.remove();
    // If the list is now empty, drop it entirely.
    if (!list.firstElementChild) list.remove();

    this.placeCaretAtStart(p);
    this.notifyChange('change');
  }

  /** Insert an empty paragraph after a blockquote/code block and move into it. */
  private exitBlock(block: HTMLElement): void {
    // Trim a trailing blank line that the user's first Enter introduced so the
    // block does not keep a dangling empty line after we break out.
    this.trimTrailingBlank(block);
    const p = this.ownerDoc().createElement('p');
    p.appendChild(this.ownerDoc().createElement('br'));
    block.parentNode?.insertBefore(p, block.nextSibling);
    if (this.isEmptyBlock(block)) block.remove();
    this.placeCaretAtStart(p);
    this.notifyChange('change');
  }

  /** Remove a single trailing newline / empty text the prior Enter created. */
  private trimTrailingBlank(block: HTMLElement): void {
    const last = block.lastChild;
    if (last && last.nodeType === 3) {
      last.textContent = (last.textContent ?? '').replace(/\n\s*$/, '');
    } else if (last && last.nodeType === 1 && (last as HTMLElement).tagName === 'BR') {
      last.remove();
    }
  }

  /** Place the collapsed caret at the start of an element. */
  private placeCaretAtStart(el: HTMLElement): void {
    const sel = this.ownerDoc().getSelection?.();
    if (!sel) return;
    const range = this.ownerDoc().createRange();
    range.selectNodeContents(el);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /**
   * Stop typed text from extending a link: when the collapsed caret sits at the
   * END of an `<a>` (the common "I just finished the link" position), move it
   * just outside the anchor so the next character is plain text, not part of the
   * href. No-op when the caret is in the middle of a link (editing link text).
   */
  private preventLinkBleed(): void {
    const sel = this.ownerDoc().getSelection?.();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!range.collapsed) return;
    const anchor = this.closestWithin(range.startContainer, 'A');
    if (!anchor) return;
    // Only intervene at the trailing boundary of the anchor.
    const probe = this.ownerDoc().createRange();
    probe.selectNodeContents(anchor);
    probe.setStart(range.endContainer, range.endOffset);
    if (probe.toString().length > 0) return; // caret is mid-link: leave it be.

    // Move the caret to immediately after the anchor element.
    const out = this.ownerDoc().createRange();
    out.setStartAfter(anchor);
    out.collapse(true);
    sel.removeAllRanges();
    sel.addRange(out);
  }

  private handleToolbarMouseDown(e: MouseEvent): void {
    const el = e.target as HTMLElement | null;
    // Value-bearing controls (selects, color swatches) must receive focus to
    // operate, so we DON'T preventDefault — instead snapshot the selection now,
    // while it still lives in the editable, to restore before applying.
    if (el?.closest('select, input')) {
      this.saveSelection();
      return;
    }
    // Keep the editor selection alive when a plain toolbar button is pressed.
    if (el?.closest('button')) e.preventDefault();
  }

  /** Apply a value-bearing control (font select / color swatch) on change. */
  private handleToolbarChange(e: Event): void {
    const ctrl = e.target as (HTMLSelectElement | HTMLInputElement) | null;
    const cmd = ctrl?.dataset.command as RichTextCommand | undefined;
    if (!ctrl || !cmd) return;
    this.exec(cmd, ctrl.value);
  }

  private handleToolbarClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>(
      'button[data-command]',
    );
    if (!btn || btn.disabled) return;
    const cmd = btn.dataset.command as RichTextCommand | undefined;
    if (cmd) this.exec(cmd);
  }

  /** Enabled toolbar buttons in DOM order (the roving-focus ring). */
  private toolbarButtons(): HTMLButtonElement[] {
    return Array.from(
      this.toolbarEl.querySelectorAll<HTMLButtonElement>('button[data-command]'),
    ).filter((b) => !b.disabled);
  }

  /** Roving-tabindex navigation: Arrow/Home/End move focus across the toolbar. */
  private handleToolbarKeydown(e: KeyboardEvent): void {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    // Let selects/inputs consume their own arrow keys (option/caret movement).
    if ((e.target as HTMLElement | null)?.closest('select, input, textarea')) return;
    const buttons = this.toolbarButtons();
    if (buttons.length === 0) return;
    const active = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>(
      'button[data-command]',
    );
    const current = active ? buttons.indexOf(active) : -1;
    let next = current;
    switch (e.key) {
      case 'ArrowRight':
        next = current < 0 ? 0 : (current + 1) % buttons.length;
        break;
      case 'ArrowLeft':
        next = current < 0 ? buttons.length - 1 : (current - 1 + buttons.length) % buttons.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = buttons.length - 1;
        break;
    }
    const target = buttons[next];
    if (!target) return;
    e.preventDefault();
    this.seedRovingTabindex(target);
    target.focus();
  }

  /** Make exactly one enabled toolbar button focusable (tabindex=0), rest -1. */
  private seedRovingTabindex(focused?: HTMLButtonElement): void {
    const buttons = this.toolbarButtons();
    const active = focused && buttons.includes(focused) ? focused : buttons[0];
    for (const btn of buttons) {
      btn.setAttribute('tabindex', btn === active ? '0' : '-1');
    }
  }

  protected override render(): void {
    const {
      readOnly = false,
      disabled = false,
      label = 'Rich text editor',
      placeholder = '',
      minHeight = '8rem',
      toolbar = DEFAULT_TOOLBAR,
      value = '',
    } = this.config;

    const editing = !readOnly && !disabled;

    this.el.className = [
      'jects-richtext',
      readOnly ? 'jects-richtext--readonly' : '',
      disabled ? 'jects-richtext--disabled' : '',
      this.config.cls ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    // ---- toolbar ----
    this.toolbarEl.hidden = toolbar.length === 0;
    this.renderToolbar(toolbar, editing);

    // ---- editable ----
    // Set the attribute explicitly (the IDL `contentEditable` setter does not
    // reliably reflect to the attribute in jsdom).
    this.editable.setAttribute('contenteditable', editing ? 'true' : 'false');
    this.editable.setAttribute('aria-label', label);
    this.editable.setAttribute('aria-readonly', String(!editing));
    this.editable.setAttribute('data-placeholder', placeholder);
    this.editable.style.minHeight = minHeight;
    if (editing) this.editable.tabIndex = 0;
    else this.editable.removeAttribute('tabindex');

    // Only (re)write content from config when it diverges, so we never clobber
    // the caret while the user is typing (input does not call render()).
    const current = this.editable.innerHTML;
    if (current !== value && this.lastHtml !== value) {
      this.editable.innerHTML = sanitizeHtml(value);
    }
    this.lastHtml = this.editable.innerHTML;

    // ---- source view ----
    // Initialize the source/WYSIWYG mode from config on first render only; the
    // toggle command owns the flag thereafter (stored on the dataset, like
    // lastHtml, to survive the field-initializer clobber).
    if (this.el.dataset.sourceMode === undefined) {
      this.el.dataset.sourceMode = String(this.config.sourceView === true);
    }
    this.sourceEl.disabled = !editing;
    this.applySourceVisibility();

    this.refreshState();
  }

  /** Rebuild toolbar buttons to match the configured layout. */
  private renderToolbar(items: RichTextToolbarItem[], editing: boolean): void {
    this.toolbarEl.replaceChildren();
    for (const item of items) {
      if (item === 'separator') {
        this.toolbarEl.appendChild(
          createEl('span', {
            className: 'jects-richtext__sep',
            attrs: { role: 'separator', 'aria-orientation': 'vertical' },
          }),
        );
        continue;
      }
      const spec = COMMANDS[item];
      if (!spec) continue;
      // Value-bearing items render as a control rather than a command button.
      if (SELECT_COMMANDS.has(item)) {
        this.toolbarEl.appendChild(
          this.buildSelectControl(item as 'fontFamily' | 'fontSize', spec, editing),
        );
        continue;
      }
      if (COLOR_COMMANDS.has(item)) {
        this.toolbarEl.appendChild(
          this.buildColorControl(item as 'foreColor' | 'backColor', spec, editing),
        );
        continue;
      }
      const title = spec.shortcut ? `${spec.title} (${spec.shortcut})` : spec.title;
      const attrs: Record<string, string> = {
        type: 'button',
        'data-command': item,
        'aria-label': spec.title,
        title,
        // Roving tabindex: all start at -1; one is promoted to 0 below.
        tabindex: '-1',
      };
      // aria-pressed only on genuine toggles, never on action buttons.
      if (TOGGLE_COMMANDS.has(item)) attrs['aria-pressed'] = 'false';
      const btn = createEl('button', {
        className: 'jects-richtext__btn',
        attrs,
      });
      btn.textContent = spec.label;
      btn.disabled = !editing;
      this.toolbarEl.appendChild(btn);
    }
    // Seed the roving-tabindex ring: exactly one enabled button is focusable.
    this.seedRovingTabindex();
  }

  /** Build a `<select>` control for fontFamily / fontSize. */
  private buildSelectControl(
    cmd: 'fontFamily' | 'fontSize',
    spec: CommandSpec,
    editing: boolean,
  ): HTMLSelectElement {
    const select = createEl('select', {
      className: 'jects-richtext__select',
      attrs: { 'data-command': cmd, 'aria-label': spec.title, title: spec.title },
    }) as HTMLSelectElement;
    const options =
      cmd === 'fontFamily'
        ? this.config.fontFamilies ?? DEFAULT_FONT_FAMILIES
        : this.config.fontSizes ?? DEFAULT_FONT_SIZES;
    // A leading placeholder option labels the control without applying a value.
    const placeholder = this.ownerDoc().createElement('option');
    placeholder.value = '';
    placeholder.textContent = spec.label;
    select.appendChild(placeholder);
    for (const opt of options) {
      const o = this.ownerDoc().createElement('option');
      o.value = cmd === 'fontFamily' && opt === 'Inherit' ? '' : opt;
      o.textContent = opt;
      select.appendChild(o);
    }
    select.disabled = !editing;
    return select;
  }

  /** Build an `<input type="color">` swatch for foreColor / backColor. */
  private buildColorControl(
    cmd: 'foreColor' | 'backColor',
    spec: CommandSpec,
    editing: boolean,
  ): HTMLLabelElement {
    const label = createEl('label', {
      className: 'jects-richtext__color',
      attrs: { title: spec.title },
    }) as HTMLLabelElement;
    const glyph = createEl('span', { className: 'jects-richtext__color-glyph' });
    glyph.textContent = spec.label;
    const input = createEl('input', {
      className: 'jects-richtext__color-input',
      attrs: {
        type: 'color',
        'data-command': cmd,
        'aria-label': spec.title,
        value: cmd === 'foreColor' ? '#000000' : '#ffff00',
      },
    }) as HTMLInputElement;
    input.disabled = !editing;
    label.appendChild(glyph);
    label.appendChild(input);
    return label;
  }

  // ---- command execution --------------------------------------------------

  /**
   * Run a toolbar/keyboard command against the current selection. Value-bearing
   * commands (`fontFamily`/`fontSize`/`foreColor`/`backColor`/`insertImage`/
   * `insertTable`) take the second argument; everything else ignores it.
   */
  exec(command: RichTextCommand, value?: string): this {
    if (this.config.readOnly || this.config.disabled || this.isDestroyed) return this;
    if (this.emit('beforeChange', { editor: this, html: this.getHTML() }) === false) {
      return this;
    }
    // Source-view toggle operates on the whole surface, not the selection — it
    // must run BEFORE we focus the editable (which is hidden in source mode).
    if (command === 'sourceView') {
      this.toggleSourceView();
      this.refreshState();
      return this;
    }
    // Snapshot the selection before focusing: focusing the editable can collapse
    // the live selection (e.g. in jsdom), and the color/font/indent commands
    // must operate on the user's original selection. restoreSelection() (called
    // by those commands) re-applies it; other commands simply ignore it.
    this.saveSelection();
    this.editable.focus();
    switch (command) {
      case 'bold':
        this.run('bold');
        break;
      case 'italic':
        this.run('italic');
        break;
      case 'underline':
        this.run('underline');
        break;
      case 'strike':
        this.run('strikeThrough');
        break;
      case 'h1':
        this.toggleBlock('H1');
        break;
      case 'h2':
        this.toggleBlock('H2');
        break;
      case 'h3':
        this.toggleBlock('H3');
        break;
      case 'paragraph':
        this.run('formatBlock', 'P');
        break;
      case 'blockquote':
        this.toggleBlock('BLOCKQUOTE');
        break;
      case 'code':
        this.toggleBlock('PRE');
        break;
      case 'ul':
        this.run('insertUnorderedList');
        break;
      case 'ol':
        this.run('insertOrderedList');
        break;
      case 'link':
        this.applyLink();
        break;
      case 'unlink':
        this.run('unlink');
        break;
      case 'alignLeft':
        this.run('justifyLeft');
        break;
      case 'alignCenter':
        this.run('justifyCenter');
        break;
      case 'alignRight':
        this.run('justifyRight');
        break;
      case 'indent':
        this.applyBlockIndent(1);
        break;
      case 'outdent':
        this.applyBlockIndent(-1);
        break;
      case 'fontFamily':
        if (value) this.applyInlineStyle('font-family', value);
        break;
      case 'fontSize':
        if (value) this.applyInlineStyle('font-size', value);
        break;
      case 'foreColor':
        if (value) this.applyInlineStyle('color', value);
        break;
      case 'backColor':
        if (value) this.applyInlineStyle('background-color', value);
        break;
      case 'insertImage':
        this.insertImage(value);
        break;
      case 'insertTable':
        this.insertTable(value);
        break;
      case 'tableAddRow':
        this.tableEdit('addRow');
        break;
      case 'tableAddColumn':
        this.tableEdit('addColumn');
        break;
      case 'tableDeleteRow':
        this.tableEdit('deleteRow');
        break;
      case 'tableDeleteColumn':
        this.tableEdit('deleteColumn');
        break;
      case 'undo':
        this.run('undo');
        break;
      case 'redo':
        this.run('redo');
        break;
      case 'clear':
        this.run('removeFormat');
        break;
    }
    this.notifyChange('change');
    this.refreshState();
    return this;
  }

  /**
   * Apply a block format, or toggle it OFF (back to a paragraph) when the caret
   * is already inside that block format. Makes blockquote/code/headings reversible
   * from the toolbar instead of one-way.
   */
  private toggleBlock(tag: string): void {
    const sel = this.ownerDoc().getSelection?.();
    let active = false;
    if (sel && sel.rangeCount > 0) {
      const node = sel.getRangeAt(0).startContainer;
      if (this.editable.contains(node) && this.closestWithin(node, tag)) active = true;
    }
    this.run('formatBlock', active ? 'P' : tag);
  }

  /** Execute a document command, falling back to a Range-based shim. */
  private run(command: string, value?: string): void {
    const doc = this.ownerDoc();
    const exec = (doc as Document & { execCommand?: typeof document.execCommand })
      .execCommand;
    if (typeof exec === 'function') {
      try {
        exec.call(doc, command, false, value);
        return;
      } catch {
        /* fall through to the shim */
      }
    }
    this.fallbackCommand(command, value);
  }

  /**
   * Minimal Selection/Range-based fallback used where execCommand is missing
   * (e.g. some jsdom paths). Covers inline wrapping and block formatting enough
   * for the public API and tests to behave deterministically.
   */
  private fallbackCommand(command: string, value?: string): void {
    const sel = this.ownerDoc().getSelection?.();
    if (command === 'formatBlock' && value) {
      this.wrapBlock(value);
      return;
    }
    const inlineTag: Record<string, string> = {
      bold: 'b',
      italic: 'i',
      underline: 'u',
      strikeThrough: 's',
    };
    const tag = inlineTag[command];
    if (tag && sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (!range.collapsed) {
        const wrapper = this.ownerDoc().createElement(tag);
        try {
          wrapper.appendChild(range.extractContents());
          range.insertNode(wrapper);
        } catch {
          /* ignore malformed ranges */
        }
      }
    }
    // undo/redo/list/align/removeFormat are no-ops in the shim — execCommand
    // covers them in real browsers; tests assert the API surface, not native
    // history.
  }

  /** Fallback block wrap: replace the nearest block ancestor's tag. */
  private wrapBlock(tagName: string): void {
    const sel = this.ownerDoc().getSelection?.();
    if (!sel || sel.rangeCount === 0) return;
    let node: Node | null = sel.getRangeAt(0).startContainer;
    while (node && node !== this.editable && node.nodeType !== 1) {
      node = node.parentNode;
    }
    const block = (node as HTMLElement | null) ?? this.editable;
    if (block === this.editable) {
      const wrapper = this.ownerDoc().createElement(tagName);
      wrapper.innerHTML = this.editable.innerHTML || '<br>';
      this.editable.replaceChildren(wrapper);
    } else {
      const replacement = this.ownerDoc().createElement(tagName);
      replacement.innerHTML = block.innerHTML;
      block.replaceWith(replacement);
    }
  }

  /** Prompt-free link insertion: wraps the selection (or inserts a placeholder). */
  private applyLink(href = 'https://example.com'): void {
    const sel = this.ownerDoc().getSelection?.();
    if (sel && sel.rangeCount > 0 && !sel.getRangeAt(0).collapsed) {
      this.run('createLink', href);
      // Harden links: ensure rel for target=_blank safety.
      this.editable.querySelectorAll('a[href]').forEach((a) => {
        if (a.getAttribute('target') === '_blank') a.setAttribute('rel', 'noopener noreferrer');
      });
    } else {
      this.insertHtml(`<a href="${escapeAttr(href)}">${escapeHtml(href)}</a>`);
    }
  }

  // ---- images / tables / inline style / indent ----------------------------

  /**
   * Insert an `<img>` at the caret. `src` may be an http(s) URL or a
   * `data:image/...` URL; when omitted a neutral placeholder is used so the
   * toolbar button is functional without a prompt.
   */
  private insertImage(src?: string): void {
    const url = (src ?? 'https://placehold.co/160x100?text=Image').trim();
    if (!isSafeImageUrl(url)) return;
    this.insertHtml(`<img src="${escapeAttr(url)}" alt="">`);
  }

  /**
   * Insert a `rows × cols` table at the caret. `size` is `"RxC"` (e.g. `"3x4"`);
   * defaults to a 2×2 grid. Cells carry a non-breaking space so empty cells are
   * still clickable/sized.
   */
  private insertTable(size?: string): void {
    const m = /^(\d+)\s*[x×]\s*(\d+)$/i.exec((size ?? '2x2').trim());
    const rows = clampDim(m ? Number(m[1]) : 2);
    const cols = clampDim(m ? Number(m[2]) : 2);
    const tr = `<tr>${'<td> </td>'.repeat(cols)}</tr>`;
    this.insertHtml(`<table><tbody>${tr.repeat(rows)}</tbody></table><p><br></p>`);
  }

  /** Mutate the table containing the selection (add/remove a row or column). */
  private tableEdit(op: 'addRow' | 'addColumn' | 'deleteRow' | 'deleteColumn'): void {
    const cell = this.currentCell();
    if (!cell) return;
    const row = cell.parentElement as HTMLTableRowElement | null;
    const table = this.closestWithin(cell, 'TABLE') as HTMLTableElement | null;
    if (!row || !table) return;
    const rows = Array.from(table.querySelectorAll('tr'));
    const colIndex = Array.from(row.children).indexOf(cell);

    if (op === 'addRow') {
      const fresh = row.cloneNode(true) as HTMLTableRowElement;
      for (const c of Array.from(fresh.children)) c.innerHTML = ' ';
      row.parentNode?.insertBefore(fresh, row.nextSibling);
    } else if (op === 'addColumn') {
      for (const r of rows) {
        const ref = r.children[colIndex] ?? null;
        const td = this.ownerDoc().createElement('td');
        td.innerHTML = ' ';
        r.insertBefore(td, ref ? ref.nextSibling : null);
      }
    } else if (op === 'deleteRow') {
      if (rows.length > 1) row.remove();
      else table.remove();
    } else if (op === 'deleteColumn') {
      const width = row.children.length;
      if (width > 1) for (const r of rows) r.children[colIndex]?.remove();
      else table.remove();
    }
  }

  /** The table cell currently holding the caret, or the last cell as a fallback. */
  private currentCell(): HTMLTableCellElement | null {
    const sel = this.ownerDoc().getSelection?.();
    if (sel && sel.rangeCount > 0) {
      const start = sel.getRangeAt(0).startContainer;
      if (this.editable.contains(start)) {
        const cell =
          this.closestWithin(start, 'TD') ?? this.closestWithin(start, 'TH');
        if (cell) return cell as HTMLTableCellElement;
      }
    }
    const cells = this.editable.querySelectorAll<HTMLTableCellElement>('td, th');
    return cells.length ? cells[cells.length - 1]! : null;
  }

  /**
   * Wrap the current selection in a `<span>` carrying a single CSS declaration
   * (color / background / font). Collapsed selections are a no-op. Used for the
   * color and font commands so behavior is deterministic across browsers and
   * jsdom (rather than relying on the patchy execCommand color/font support).
   */
  private applyInlineStyle(prop: string, value: string): void {
    this.restoreSelection();
    const sel = this.ownerDoc().getSelection?.();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed || !this.editable.contains(range.commonAncestorContainer)) return;
    const span = this.ownerDoc().createElement('span');
    span.style.setProperty(prop, value);
    try {
      span.appendChild(range.extractContents());
      range.insertNode(span);
    } catch {
      return; // malformed range — leave the document untouched
    }
    // Re-select the styled content so a subsequent style stacks naturally.
    const after = this.ownerDoc().createRange();
    after.selectNodeContents(span);
    sel.removeAllRanges();
    sel.addRange(after);
  }

  /**
   * Increase (`delta > 0`) or decrease the left indent of the nearest block by
   * one 2em step, via an inline `margin-left` (kept on the sanitizer allow-list).
   */
  private applyBlockIndent(delta: number): void {
    this.restoreSelection();
    const sel = this.ownerDoc().getSelection?.();
    if (!sel || sel.rangeCount === 0) return;
    const block = this.blockAncestor(sel.getRangeAt(0).startContainer);
    if (!block) return;
    const step = 2; // em
    const current = parseFloat(block.style.marginLeft) || 0;
    const next = Math.max(0, current + delta * step);
    if (next <= 0) block.style.removeProperty('margin-left');
    else block.style.marginLeft = `${next}em`;
  }

  /** Nearest block-level ancestor of `node` within the editable (or its top child). */
  private blockAncestor(node: Node): HTMLElement | null {
    let cur: Node | null = node;
    while (cur && cur !== this.editable) {
      if (cur.nodeType === 1 && BLOCK_TAGS.has((cur as HTMLElement).tagName)) {
        return cur as HTMLElement;
      }
      cur = cur.parentNode;
    }
    // No recognized block: fall back to the top-level child wrapping the node.
    let child: Node | null = node;
    while (child && child.parentNode && child.parentNode !== this.editable) {
      child = child.parentNode;
    }
    return child && child.nodeType === 1 ? (child as HTMLElement) : null;
  }

  // ---- source view --------------------------------------------------------

  /** Toggle between the WYSIWYG surface and the raw-HTML source textarea. */
  private toggleSourceView(): void {
    const entering = this.el.dataset.sourceMode !== 'true';
    if (entering) {
      // Snapshot the current document into the textarea for editing.
      this.sourceEl.value = this.getHTML();
    } else {
      // Sync edits back through the sanitizer into the rendered document.
      this.setHTML(this.sourceEl.value);
    }
    this.el.dataset.sourceMode = String(entering);
    this.applySourceVisibility();
  }

  /** Reflect the current source/WYSIWYG mode onto the DOM (visibility + toolbar). */
  private applySourceVisibility(): void {
    const source = this.el.dataset.sourceMode === 'true';
    const editing = !this.config.readOnly && !this.config.disabled;
    this.sourceEl.hidden = !source;
    this.editable.hidden = source;
    this.el.classList.toggle('jects-richtext--source', source);
    // In source mode every command except the toggle is disabled (you edit raw
    // HTML, not formatted selections).
    for (const btn of this.toolbarEl.querySelectorAll<HTMLButtonElement>(
      'button[data-command]',
    )) {
      const cmd = btn.dataset.command as RichTextCommand | undefined;
      btn.disabled = !editing || (source && cmd !== 'sourceView');
      if (cmd === 'sourceView') {
        btn.setAttribute('aria-pressed', String(source));
        btn.classList.toggle('jects-richtext__btn--active', source);
      }
    }
    for (const ctrl of this.toolbarEl.querySelectorAll<HTMLSelectElement | HTMLInputElement>(
      'select[data-command], input[data-command]',
    )) {
      ctrl.disabled = !editing || source;
    }
  }

  // ---- selection save / restore -------------------------------------------

  /** Snapshot the current editable selection (before focus moves to a control). */
  private saveSelection(): void {
    const sel = this.ownerDoc().getSelection?.();
    this.savedRange =
      sel && sel.rangeCount > 0 && this.editable.contains(sel.getRangeAt(0).commonAncestorContainer)
        ? sel.getRangeAt(0).cloneRange()
        : null;
  }

  /** Restore a previously-saved selection if it is still valid; then clear it. */
  private restoreSelection(): void {
    const range = this.savedRange;
    this.savedRange = null;
    if (!range || !this.editable.contains(range.commonAncestorContainer)) return;
    const sel = this.ownerDoc().getSelection?.();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // ---- selection insertion helpers ----------------------------------------

  /** Insert sanitized HTML at the caret (or replace the selection). */
  private insertHtml(html: string): void {
    const sel = this.ownerDoc().getSelection?.();
    if (!sel || sel.rangeCount === 0) {
      this.editable.innerHTML += sanitizeHtml(html);
      return;
    }
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const tpl = this.ownerDoc().createElement('template');
    tpl.innerHTML = sanitizeHtml(html);
    const frag = tpl.content;
    const last = frag.lastChild;
    range.insertNode(frag);
    if (last) {
      range.setStartAfter(last);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  /** Insert plain text at the caret. */
  private insertText(text: string): void {
    const sel = this.ownerDoc().getSelection?.();
    if (!sel || sel.rangeCount === 0) {
      this.editable.append(this.ownerDoc().createTextNode(text));
      return;
    }
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = this.ownerDoc().createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // ---- state / events -----------------------------------------------------

  /** Reflect active formatting onto toolbar buttons via `aria-pressed`. */
  private refreshState(): void {
    const doc = this.ownerDoc();
    const queryState = (
      doc as Document & { queryCommandState?: (c: string) => boolean }
    ).queryCommandState;
    const map: Partial<Record<RichTextCommand, string>> = {
      bold: 'bold',
      italic: 'italic',
      underline: 'underline',
      strike: 'strikeThrough',
      ul: 'insertUnorderedList',
      ol: 'insertOrderedList',
      alignLeft: 'justifyLeft',
      alignCenter: 'justifyCenter',
      alignRight: 'justifyRight',
    };
    for (const btn of this.toolbarEl.querySelectorAll<HTMLButtonElement>(
      'button[data-command]',
    )) {
      const cmd = btn.dataset.command as RichTextCommand | undefined;
      // Only genuine toggles carry aria-pressed; action buttons never do.
      if (!cmd || !TOGGLE_COMMANDS.has(cmd)) continue;
      // sourceView's pressed state is owned by applySourceVisibility (mode flag),
      // not by a native queryCommandState — leave it alone here.
      if (cmd === 'sourceView') continue;
      const native = map[cmd];
      let active = false;
      if (native && typeof queryState === 'function') {
        try {
          active = queryState.call(doc, native);
        } catch {
          active = false;
        }
      }
      btn.setAttribute('aria-pressed', String(active));
      btn.classList.toggle('jects-richtext__btn--active', active);
    }
  }

  /** Emit change/input after content mutated, gated by `beforeChange` veto. */
  private notifyChange(kind: 'input' | 'change'): void {
    const html = this.getHTML();
    if (kind === 'input') {
      this.emit('input', { editor: this, html });
    }
    if (html !== this.lastHtml) {
      this.lastHtml = html;
      this.emit('change', { editor: this, html });
    } else if (kind === 'change') {
      // commands may not alter innerHTML in the jsdom shim but are still
      // semantically a change request — surface it once.
      this.emit('change', { editor: this, html });
    }
  }

  private ownerDoc(): Document {
    return this.el.ownerDocument ?? document;
  }

  // ---- public API ---------------------------------------------------------

  /** Current editor HTML (sanitized). */
  getHTML(): string {
    return sanitizeHtml(this.editable.innerHTML);
  }

  /** Replace the editor content with sanitized HTML. Fires `change`. */
  setHTML(html: string): this {
    const clean = sanitizeHtml(html);
    this.editable.innerHTML = clean;
    this.config = { ...this.config, value: clean };
    this.notifyChange('change');
    this.refreshState();
    return this;
  }

  /** Serialize the current content to Markdown (best-effort, common blocks). */
  getMarkdown(): string {
    return htmlToMarkdown(this.editable);
  }

  /**
   * Replace the editor content from a Markdown string (headings, bold/italic,
   * lists, links, inline code, blockquote, fenced code). Fires `change`.
   */
  setMarkdown(markdown: string): this {
    return this.setHTML(markdownToHtml(markdown));
  }

  /** Focus the editable region. */
  focusEditor(): this {
    this.editable.focus();
    return this;
  }

  /** Clear all content. Fires `change`. */
  clear(): this {
    return this.setHTML('');
  }

  override destroy(): void {
    // All listeners live on the editable/toolbar children of the root; removing
    // the root (in super.destroy) detaches them and makes them GC-eligible. No
    // document-level listeners are registered, so there is nothing else to undo.
    super.destroy();
  }
}

// ---- sanitization ---------------------------------------------------------

/**
 * Sanitize an HTML string to the editor's allow-list. Strips scripts, event
 * handlers, disallowed tags/attributes, `javascript:` URLs, and all but the
 * `text-align` inline style. Returns a normalized HTML string.
 */
export function sanitizeHtml(html: string): string {
  if (!html) return '';
  // Canonical security pass: route through the shared @jects/core allow-list
  // sanitizer (the single source of truth per docs/SECURITY.md) — it strips
  // script/style/iframe/object/embed/etc. and `on*` handlers, and neutralizes
  // javascript:/vbscript:/unsafe-data: URLs. RichText then layers its stricter
  // EDITOR normalization (the narrower tag set + inline-style property allow-list)
  // on top, so the editor still only emits its supported formatting.
  const secured = coreSanitizeHtml(html);
  const doc = document.implementation.createHTMLDocument('');
  const tpl = doc.createElement('template');
  tpl.innerHTML = secured;
  sanitizeNode(tpl.content);
  return tpl.innerHTML;
}

/**
 * Aggressively clean pasted HTML (the `pasteClean` path): drop scripts/styles,
 * strip every presentational attribute (`class`, `style`, `id`, `dir`, `lang`,
 * Office/`mso-*` noise) and unwrap non-semantic wrappers (`SPAN`, `FONT`, `DIV`,
 * `O:P`), keeping only the semantic structure. The result is then run through
 * the standard allow-list `sanitizeHtml` by the caller for final safety.
 */
export function cleanPastedHtml(html: string): string {
  if (!html) return '';
  const doc = document.implementation.createHTMLDocument('');
  const tpl = doc.createElement('template');
  tpl.innerHTML = html;
  cleanPasteNode(tpl.content);
  return tpl.innerHTML;
}

/** Tags unwrapped (replaced by their children) during a paste clean. */
const PASTE_UNWRAP = new Set(['SPAN', 'FONT', 'DIV', 'O:P', 'B:R', 'XML']);

function cleanPasteNode(root: ParentNode): void {
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === 8) {
      node.parentNode?.removeChild(node); // comments
      continue;
    }
    if (node.nodeType !== 1) continue;
    const el = node as HTMLElement;
    const tag = el.tagName.toUpperCase();
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'META' || tag === 'LINK') {
      el.remove();
      continue;
    }
    cleanPasteNode(el);
    // Strip ALL presentational/junk attributes — keep only structural ones.
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const keep =
        (tag === 'A' && (name === 'href' || name === 'title')) ||
        (tag === 'IMG' && (name === 'src' || name === 'alt'));
      if (!keep) el.removeAttribute(attr.name);
    }
    if (PASTE_UNWRAP.has(tag)) {
      const parent = el.parentNode;
      if (parent) {
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
      }
    }
  }
}

function sanitizeNode(root: ParentNode): void {
  // Walk a static snapshot — we mutate the tree as we go.
  const children = Array.from(root.childNodes);
  for (const node of children) {
    if (node.nodeType === 8) {
      // comment
      node.parentNode?.removeChild(node);
      continue;
    }
    if (node.nodeType !== 1) continue; // keep text, drop the rest above
    const el = node as HTMLElement;
    const tag = el.tagName.toUpperCase();

    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'IFRAME' || tag === 'OBJECT' || tag === 'EMBED') {
      el.remove();
      continue;
    }

    if (!ALLOWED_TAGS.has(tag)) {
      // Unwrap: replace the element with its (sanitized) children.
      sanitizeNode(el);
      const parent = el.parentNode;
      if (parent) {
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
      }
      continue;
    }

    scrubAttributes(el, tag);
    sanitizeNode(el);
  }
}

function scrubAttributes(el: HTMLElement, tag: string): void {
  const tagAllow = ALLOWED_ATTRS[tag];
  const globalAllow = ALLOWED_ATTRS['*'];
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    if (name.startsWith('on')) {
      el.removeAttribute(attr.name);
      continue;
    }
    const allowed =
      (tagAllow && tagAllow.has(name)) || (globalAllow && globalAllow.has(name));
    if (!allowed) {
      el.removeAttribute(attr.name);
      continue;
    }
    if (name === 'href') {
      if (!isSafeUrl(attr.value)) el.removeAttribute(attr.name);
    } else if (name === 'src') {
      if (!isSafeImageUrl(attr.value)) el.removeAttribute(attr.name);
    } else if (name === 'style') {
      const safe = filterStyle(attr.value);
      if (safe) el.setAttribute('style', safe);
      else el.removeAttribute('style');
    }
  }
}

function isSafeUrl(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  if (
    trimmed.startsWith('javascript:') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('vbscript:')
  ) {
    return false;
  }
  return true;
}

/**
 * Image-source policy: like `isSafeUrl`, but additionally permits inline
 * `data:image/...` URLs (the supported data-URL image case) while still blocking
 * scriptable schemes.
 */
function isSafeImageUrl(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  if (trimmed.startsWith('javascript:') || trimmed.startsWith('vbscript:')) return false;
  if (trimmed.startsWith('data:')) return trimmed.startsWith('data:image/');
  return true;
}

/** Clamp a table dimension to a sane 1..50 range. */
function clampDim(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(50, Math.floor(n)));
}

function filterStyle(style: string): string {
  const parts: string[] = [];
  for (const decl of style.split(';')) {
    const idx = decl.indexOf(':');
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const val = decl.slice(idx + 1).trim();
    if (!prop || !val) continue;
    if (val.toLowerCase().includes('url(') || val.toLowerCase().includes('expression')) continue;
    if (ALLOWED_STYLES.has(prop)) parts.push(`${prop}: ${val}`);
  }
  return parts.join('; ');
}

// ---- markdown -------------------------------------------------------------

/**
 * Convert a Markdown string to HTML (best-effort, line-based). Supports ATX
 * headings, unordered (`-`/`*`/`+`) and ordered (`1.`) lists, blockquotes,
 * fenced code blocks, and inline bold/italic/strike/code/link. The output is
 * sanitized by the caller (`setHTML`) before it reaches the document.
 */
function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    // Fenced code block.
    if (/^```/.test(line.trim())) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test((lines[i] ?? '').trim())) {
        body.push(lines[i] ?? '');
        i++;
      }
      i++; // consume closing fence
      out.push(`<pre>${escapeHtml(body.join('\n'))}</pre>`);
      continue;
    }
    // Blank line.
    if (line.trim() === '') {
      i++;
      continue;
    }
    // Heading.
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1]!.length;
      out.push(`<h${level}>${mdInline(h[2]!)}</h${level}>`);
      i++;
      continue;
    }
    // Blockquote (consume consecutive `>` lines).
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i] ?? '')) {
        quote.push((lines[i] ?? '').replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${mdInline(quote.join(' '))}</blockquote>`);
      continue;
    }
    // Unordered list.
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i] ?? '')) {
        items.push(mdInline((lines[i] ?? '').replace(/^\s*[-*+]\s+/, '')));
        i++;
      }
      out.push(`<ul>${items.map((t) => `<li>${t}</li>`).join('')}</ul>`);
      continue;
    }
    // Ordered list.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? '')) {
        items.push(mdInline((lines[i] ?? '').replace(/^\s*\d+\.\s+/, '')));
        i++;
      }
      out.push(`<ol>${items.map((t) => `<li>${t}</li>`).join('')}</ol>`);
      continue;
    }
    // Paragraph (single line).
    out.push(`<p>${mdInline(line)}</p>`);
    i++;
  }
  return out.join('');
}

/** Inline Markdown → HTML: code, bold, italic, strike, links (escape-safe). */
function mdInline(src: string): string {
  let s = escapeHtml(src);
  // Inline code first so its contents are not re-formatted.
  s = s.replace(/`([^`]+)`/g, (_m, c: string) => `<code>${c}</code>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t: string, u: string) => {
    return isSafeUrl(u) ? `<a href="${escapeAttr(u)}">${t}</a>` : t;
  });
  return s;
}

/** Convert a sanitized editor DOM subtree to Markdown (best-effort). */
function htmlToMarkdown(root: HTMLElement): string {
  const out: string[] = [];
  for (const node of Array.from(root.childNodes)) {
    out.push(serializeBlock(node));
  }
  return out
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function serializeBlock(node: Node): string {
  if (node.nodeType === 3) return (node.textContent ?? '').trim();
  if (node.nodeType !== 1) return '';
  const el = node as HTMLElement;
  switch (el.tagName) {
    case 'H1':
      return `# ${serializeInline(el)}`;
    case 'H2':
      return `## ${serializeInline(el)}`;
    case 'H3':
      return `### ${serializeInline(el)}`;
    case 'H4':
      return `#### ${serializeInline(el)}`;
    case 'H5':
      return `##### ${serializeInline(el)}`;
    case 'H6':
      return `###### ${serializeInline(el)}`;
    case 'BLOCKQUOTE':
      return serializeInline(el)
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n');
    case 'PRE':
      return '```\n' + (el.textContent ?? '') + '\n```';
    case 'UL':
      return Array.from(el.children)
        .map((li) => `- ${serializeInline(li as HTMLElement)}`)
        .join('\n');
    case 'OL':
      return Array.from(el.children)
        .map((li, i) => `${i + 1}. ${serializeInline(li as HTMLElement)}`)
        .join('\n');
    case 'BR':
      return '';
    default:
      return serializeInline(el);
  }
}

function serializeInline(el: Node): string {
  let out = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) {
      out += node.textContent ?? '';
      continue;
    }
    if (node.nodeType !== 1) continue;
    const child = node as HTMLElement;
    const inner = serializeInline(child);
    switch (child.tagName) {
      case 'B':
      case 'STRONG':
        out += `**${inner}**`;
        break;
      case 'I':
      case 'EM':
        out += `*${inner}*`;
        break;
      case 'S':
      case 'STRIKE':
      case 'DEL':
        out += `~~${inner}~~`;
        break;
      case 'CODE':
        out += `\`${inner}\``;
        break;
      case 'A':
        out += `[${inner}](${child.getAttribute('href') ?? ''})`;
        break;
      case 'BR':
        out += '\n';
        break;
      default:
        out += inner;
    }
  }
  return out;
}

// ---- small html escapers --------------------------------------------------

// Escapers delegate to the shared @jects/core `escape` (which also escapes
// quotes), so RichText keeps no duplicate escape implementation.
function escapeHtml(s: string): string {
  return coreEscape(s);
}

function escapeAttr(s: string): string {
  return coreEscape(s);
}

/**
 * True for a key that inserts a visible character (so it would extend a link if
 * the caret were inside an anchor). Excludes modifiers, navigation, editing and
 * function keys — `e.key` is a single grapheme only for printable input.
 */
function isPrintableKey(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  // Single-character keys (letters, digits, punctuation, space) are printable.
  return e.key.length === 1;
}

register(
  'richtext',
  RichText as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => RichText,
);
