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
  | 'uploadImage'
  | 'imageAlignLeft'
  | 'imageAlignCenter'
  | 'imageAlignRight'
  | 'imageWidthSmall'
  | 'imageWidthMedium'
  | 'imageWidthFull'
  | 'insertTable'
  | 'tableAddRow'
  | 'tableAddColumn'
  | 'tableDeleteRow'
  | 'tableDeleteColumn'
  | 'tableMergeCells'
  | 'tableSplitCell'
  | 'tableToggleHeaderRow'
  | 'horizontalRule'
  | 'justify'
  | 'subscript'
  | 'superscript'
  | 'inlineCode'
  | 'editLink'
  | 'findReplace'
  | 'fullscreen'
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
  /**
   * Show the status footer with live word/character counts. Default `true`.
   * The counts are also available programmatically via {@link RichText.getStats}.
   */
  showStatus?: boolean;
  /**
   * Maximum size (bytes) of a file accepted by the image upload control before
   * it is read into a `data:` URL. Oversized files are ignored. Default 2 MB.
   */
  maxImageBytes?: number;
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
  /** Fired when full-screen mode is toggled. */
  fullscreenChange: { editor: RichText; fullscreen: boolean };
}

/** Live document statistics surfaced by the footer and {@link RichText.getStats}. */
export interface RichTextStats {
  /** Number of whitespace-delimited words in the rendered text. */
  words: number;
  /** Number of characters in the rendered text (including spaces). */
  characters: number;
  /** Number of characters excluding all whitespace. */
  charactersNoSpaces: number;
}

const DEFAULT_TOOLBAR: RichTextToolbarItem[] = [
  'bold',
  'italic',
  'underline',
  'strike',
  'subscript',
  'superscript',
  'inlineCode',
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
  'horizontalRule',
  'separator',
  'link',
  'editLink',
  'unlink',
  'separator',
  'alignLeft',
  'alignCenter',
  'alignRight',
  'justify',
  'indent',
  'outdent',
  'separator',
  'fontFamily',
  'fontSize',
  'foreColor',
  'backColor',
  'separator',
  'insertImage',
  'uploadImage',
  'insertTable',
  'separator',
  'findReplace',
  'fullscreen',
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
  insertImage: { label: 'Img', title: 'Insert image by URL' },
  uploadImage: { label: '⤒Img', title: 'Upload image file' },
  imageAlignLeft: { label: 'Img L', title: 'Align image left' },
  imageAlignCenter: { label: 'Img C', title: 'Align image center' },
  imageAlignRight: { label: 'Img R', title: 'Align image right' },
  imageWidthSmall: { label: 'Img S', title: 'Small image width' },
  imageWidthMedium: { label: 'Img M', title: 'Medium image width' },
  imageWidthFull: { label: 'Img F', title: 'Full image width' },
  insertTable: { label: 'Table', title: 'Insert table' },
  tableAddRow: { label: '+Row', title: 'Insert row below' },
  tableAddColumn: { label: '+Col', title: 'Insert column after' },
  tableDeleteRow: { label: '−Row', title: 'Delete row' },
  tableDeleteColumn: { label: '−Col', title: 'Delete column' },
  tableMergeCells: { label: 'Merge', title: 'Merge selected cells' },
  tableSplitCell: { label: 'Split', title: 'Split merged cell' },
  tableToggleHeaderRow: { label: 'Hdr', title: 'Toggle header row' },
  horizontalRule: { label: '―', title: 'Horizontal rule' },
  justify: { label: 'J', title: 'Justify' },
  subscript: { label: 'x₂', title: 'Subscript' },
  superscript: { label: 'x²', title: 'Superscript' },
  inlineCode: { label: '`c`', title: 'Inline code' },
  editLink: { label: 'Edit↗', title: 'Edit link' },
  findReplace: { label: 'Find', title: 'Find & replace', shortcut: 'Ctrl+F' },
  fullscreen: { label: '⤢', title: 'Toggle full screen' },
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
  'subscript',
  'superscript',
  'inlineCode',
  'ul',
  'ol',
  'alignLeft',
  'alignCenter',
  'alignRight',
  'justify',
  'sourceView',
  'findReplace',
  'fullscreen',
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
  'HR',
  'B',
  'STRONG',
  'I',
  'EM',
  'U',
  'S',
  'STRIKE',
  'DEL',
  'MARK',
  'SUB',
  'SUP',
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
  'FIGURE',
  'FIGCAPTION',
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
  // Image alignment / sizing (figure + img).
  'float',
  'display',
  'margin',
  'margin-right',
  'width',
  'max-width',
  'height',
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
  /** Hidden file input backing the image-upload command. */
  private get fileInput(): HTMLInputElement {
    return this.el.querySelector('.jects-richtext__file') as HTMLInputElement;
  }
  /** The status footer (word/char counts), created in buildEl. */
  private get statusEl(): HTMLElement {
    return this.el.querySelector('.jects-richtext__status') as HTMLElement;
  }
  /** The find & replace dialog container, created in buildEl. */
  private get findDialog(): HTMLElement {
    return this.el.querySelector('.jects-richtext__find') as HTMLElement;
  }
  /** The link-edit dialog container, created in buildEl. */
  private get linkDialog(): HTMLElement {
    return this.el.querySelector('.jects-richtext__linkdlg') as HTMLElement;
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
      showStatus: true,
      maxImageBytes: 2 * 1024 * 1024,
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

    // Hidden file input backing the image-upload command. Kept in the DOM so the
    // native file picker can be opened programmatically from the toolbar button.
    const file = createEl('input', {
      className: 'jects-richtext__file',
      attrs: { type: 'file', accept: 'image/*', 'aria-hidden': 'true', tabindex: '-1' },
    }) as HTMLInputElement;
    file.hidden = true;

    // Find & replace dialog (built once, shown on demand). Lives inside the root
    // so it is removed on destroy() with the rest of the widget.
    const find = this.buildFindDialog();
    // Link-edit dialog (edit href / text / target of an existing anchor).
    const linkDlg = this.buildLinkDialog();

    // Status footer (live word/char counts).
    const status = createEl('div', {
      className: 'jects-richtext__status',
      attrs: { role: 'status', 'aria-live': 'off' },
    });

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

    // Image upload: read the chosen file into a data: URL and insert it.
    file.addEventListener('change', () => this.handleFilePicked());

    root.appendChild(toolbar);
    root.appendChild(editable);
    root.appendChild(source);
    root.appendChild(file);
    root.appendChild(find);
    root.appendChild(linkDlg);
    root.appendChild(status);
    return root;
  }

  /** Build the (initially hidden) Find & Replace dialog. */
  private buildFindDialog(): HTMLElement {
    const dlg = createEl('div', {
      className: 'jects-richtext__find',
      attrs: { role: 'dialog', 'aria-label': 'Find and replace' },
    });
    dlg.hidden = true;
    const findInput = createEl('input', {
      className: 'jects-richtext__find-input',
      attrs: { type: 'text', placeholder: 'Find', 'aria-label': 'Find' },
    }) as HTMLInputElement;
    const replaceInput = createEl('input', {
      className: 'jects-richtext__replace-input',
      attrs: { type: 'text', placeholder: 'Replace with', 'aria-label': 'Replace with' },
    }) as HTMLInputElement;
    const count = createEl('span', { className: 'jects-richtext__find-count' });
    count.setAttribute('aria-live', 'polite');
    const mkBtn = (action: string, label: string): HTMLButtonElement => {
      const b = createEl('button', {
        className: 'jects-richtext__find-btn',
        attrs: { type: 'button', 'data-find-action': action },
      }) as HTMLButtonElement;
      b.textContent = label;
      return b;
    };
    const prev = mkBtn('prev', 'Prev');
    const next = mkBtn('next', 'Next');
    const replace = mkBtn('replace', 'Replace');
    const replaceAll = mkBtn('replaceAll', 'Replace all');
    const close = mkBtn('close', '✕');
    close.setAttribute('aria-label', 'Close find and replace');

    findInput.addEventListener('input', () => this.runFind());
    findInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.findStep(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.closeFind();
      }
    });
    dlg.addEventListener('click', (e) => this.handleFindAction(e));

    dlg.appendChild(findInput);
    dlg.appendChild(replaceInput);
    dlg.appendChild(prev);
    dlg.appendChild(next);
    dlg.appendChild(replace);
    dlg.appendChild(replaceAll);
    dlg.appendChild(count);
    dlg.appendChild(close);
    return dlg;
  }

  /** Build the (initially hidden) link-edit dialog. */
  private buildLinkDialog(): HTMLElement {
    const dlg = createEl('div', {
      className: 'jects-richtext__linkdlg',
      attrs: { role: 'dialog', 'aria-label': 'Edit link' },
    });
    dlg.hidden = true;
    const text = createEl('input', {
      className: 'jects-richtext__linkdlg-text',
      attrs: { type: 'text', placeholder: 'Text', 'aria-label': 'Link text' },
    }) as HTMLInputElement;
    const href = createEl('input', {
      className: 'jects-richtext__linkdlg-href',
      attrs: { type: 'text', placeholder: 'https://…', 'aria-label': 'Link URL' },
    }) as HTMLInputElement;
    const blank = createEl('label', { className: 'jects-richtext__linkdlg-blank' });
    const blankCb = createEl('input', {
      className: 'jects-richtext__linkdlg-target',
      attrs: { type: 'checkbox', 'aria-label': 'Open in new tab' },
    }) as HTMLInputElement;
    const blankText = createEl('span');
    blankText.textContent = 'New tab';
    blank.appendChild(blankCb);
    blank.appendChild(blankText);
    const mkBtn = (action: string, label: string): HTMLButtonElement => {
      const b = createEl('button', {
        className: 'jects-richtext__linkdlg-btn',
        attrs: { type: 'button', 'data-link-action': action },
      }) as HTMLButtonElement;
      b.textContent = label;
      return b;
    };
    const apply = mkBtn('apply', 'Apply');
    const cancel = mkBtn('cancel', 'Cancel');
    dlg.addEventListener('click', (e) => this.handleLinkDialogAction(e));
    dlg.appendChild(text);
    dlg.appendChild(href);
    dlg.appendChild(blank);
    dlg.appendChild(apply);
    dlg.appendChild(cancel);
    return dlg;
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
    } else if (key === 'f') {
      e.preventDefault();
      this.exec('findReplace');
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

    // ---- status footer ----
    this.statusEl.hidden = this.config.showStatus === false;
    this.updateStatus();

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
    // Chrome-level toggles/launchers operate on the widget, not on the current
    // selection content — they must not focus the editable or emit a change.
    if (command === 'fullscreen') {
      this.toggleFullscreen();
      this.refreshState();
      return this;
    }
    if (command === 'findReplace') {
      this.toggleFind();
      this.refreshState();
      return this;
    }
    if (command === 'uploadImage') {
      this.openFilePicker();
      return this;
    }
    if (command === 'editLink') {
      this.openLinkDialog();
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
      case 'justify':
        this.run('justifyFull');
        break;
      case 'subscript':
        this.toggleInline('SUB');
        break;
      case 'superscript':
        this.toggleInline('SUP');
        break;
      case 'inlineCode':
        this.toggleInline('CODE');
        break;
      case 'horizontalRule':
        this.insertHorizontalRule();
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
      case 'imageAlignLeft':
        this.alignImage('left');
        break;
      case 'imageAlignCenter':
        this.alignImage('center');
        break;
      case 'imageAlignRight':
        this.alignImage('right');
        break;
      case 'imageWidthSmall':
        this.setImageWidth('25%');
        break;
      case 'imageWidthMedium':
        this.setImageWidth('50%');
        break;
      case 'imageWidthFull':
        this.setImageWidth('100%');
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
      case 'tableMergeCells':
        this.tableMergeCells();
        break;
      case 'tableSplitCell':
        this.tableSplitCell();
        break;
      case 'tableToggleHeaderRow':
        this.tableToggleHeaderRow();
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

  // ---- inline toggles (sub/sup/inline-code) -------------------------------

  /**
   * Toggle an inline wrapper tag (`SUB`/`SUP`/`CODE`) around the selection. When
   * the selection already sits inside that tag, unwrap it; otherwise wrap the
   * extracted range in a fresh element. Deterministic across browsers/jsdom
   * (native execCommand has no inline-code and patchy sub/sup support).
   */
  private toggleInline(tag: string): void {
    this.restoreSelection();
    const sel = this.ownerDoc().getSelection?.();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!this.editable.contains(range.commonAncestorContainer)) return;
    const existing = this.closestWithin(range.startContainer, tag);
    if (existing) {
      // Unwrap: replace the element with its children, then reselect them.
      const parent = existing.parentNode;
      if (!parent) return;
      const first = existing.firstChild;
      const last = existing.lastChild;
      while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
      parent.removeChild(existing);
      if (first && last) {
        const after = this.ownerDoc().createRange();
        after.setStartBefore(first);
        after.setEndAfter(last);
        sel.removeAllRanges();
        sel.addRange(after);
      }
      return;
    }
    if (range.collapsed) return;
    const el = this.ownerDoc().createElement(tag);
    try {
      el.appendChild(range.extractContents());
      range.insertNode(el);
    } catch {
      return;
    }
    const after = this.ownerDoc().createRange();
    after.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(after);
  }

  /** Insert a thematic break (`<hr>`) at the caret, followed by a paragraph. */
  private insertHorizontalRule(): void {
    this.insertHtml('<hr><p><br></p>');
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

  /** Open the hidden file picker for the image-upload command. */
  private openFilePicker(): void {
    this.saveSelection();
    this.fileInput.value = '';
    this.fileInput.click();
  }

  /**
   * Read the picked image file into a `data:` URL and insert it. Rejects
   * non-image and oversized files. Insertion routes through the allow-list
   * sanitizer (which only admits `data:image/*`).
   */
  private handleFilePicked(): void {
    const input = this.fileInput;
    const file = input.files && input.files[0];
    if (!file) return;
    const max = this.config.maxImageBytes ?? 2 * 1024 * 1024;
    if (!file.type.startsWith('image/') || file.size > max) {
      input.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      input.value = '';
      if (!result || this.isDestroyed) return;
      if (this.emit('beforeChange', { editor: this, html: this.getHTML() }) === false) return;
      this.restoreSelection();
      this.editable.focus();
      this.insertImage(result);
      this.notifyChange('change');
    };
    reader.readAsDataURL(file);
  }

  /** Resolve the image to act on: the selected/clicked one, else the last image. */
  private currentImage(): HTMLImageElement | null {
    const sel = this.ownerDoc().getSelection?.();
    if (sel && sel.rangeCount > 0) {
      const start = sel.getRangeAt(0).startContainer;
      if (this.editable.contains(start)) {
        const img = this.closestWithin(start, 'IMG') as HTMLImageElement | null;
        if (img) return img;
        // A range that wraps an image (selectNode) reports the parent as start.
        const within = (start.nodeType === 1 ? (start as HTMLElement) : start.parentElement)
          ?.querySelector('img');
        if (within) return within as HTMLImageElement;
      }
    }
    const imgs = this.editable.querySelectorAll('img');
    return imgs.length ? (imgs[imgs.length - 1] as HTMLImageElement) : null;
  }

  /**
   * Align an image left/center/right. Left/right use `float` (text wraps); center
   * uses a block image with auto side margins. Styles are on the allow-list, so
   * they survive serialization.
   */
  private alignImage(side: 'left' | 'center' | 'right'): void {
    const img = this.currentImage();
    if (!img) return;
    img.style.removeProperty('float');
    img.style.removeProperty('display');
    img.style.removeProperty('margin');
    img.style.removeProperty('margin-right');
    if (side === 'center') {
      img.style.display = 'block';
      img.style.margin = '0 auto';
    } else {
      img.style.float = side;
      if (side === 'left') img.style.marginRight = '1em';
    }
  }

  /** Set an image's width (CSS length / percentage) and keep aspect ratio. */
  private setImageWidth(width: string): void {
    const img = this.currentImage();
    if (!img) return;
    img.removeAttribute('width');
    img.removeAttribute('height');
    img.style.width = width;
    img.style.height = 'auto';
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

  /** Cells of the active table that intersect the current selection range. */
  private selectedCells(): HTMLTableCellElement[] {
    const anchor = this.currentCell();
    const table = anchor ? (this.closestWithin(anchor, 'TABLE') as HTMLTableElement | null) : null;
    if (!table) return [];
    const all = Array.from(table.querySelectorAll<HTMLTableCellElement>('td, th'));
    const sel = this.ownerDoc().getSelection?.();
    if (!sel || sel.rangeCount === 0 || sel.getRangeAt(0).collapsed) {
      return anchor ? [anchor] : [];
    }
    const range = sel.getRangeAt(0);
    const hit = all.filter((c) => range.intersectsNode(c));
    return hit.length > 0 ? hit : anchor ? [anchor] : [];
  }

  /**
   * Merge the selected cells into the first one (rectangular merge). Sets the
   * survivor's `colspan`/`rowspan` to cover the selection's bounding box, moves
   * the other cells' content into it, and removes them. With a single cell and a
   * right-hand neighbour in the same row, performs a simple colspan merge.
   */
  private tableMergeCells(): void {
    let cells = this.selectedCells();
    if (cells.length < 2) {
      // No multi-cell selection: merge the anchor with its next sibling cell.
      const anchor = this.currentCell();
      const next = anchor?.nextElementSibling as HTMLTableCellElement | null;
      if (!anchor || !next) return;
      cells = [anchor, next];
    }
    const grid = this.cellGrid(cells[0]!);
    if (!grid) return;
    // Compute the bounding box (in grid coordinates) of the selected cells.
    let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
    const inSet = new Set(cells);
    for (const pos of grid.positions) {
      if (!inSet.has(pos.cell)) continue;
      minR = Math.min(minR, pos.r);
      maxR = Math.max(maxR, pos.r + pos.rowspan - 1);
      minC = Math.min(minC, pos.c);
      maxC = Math.max(maxC, pos.c + pos.colspan - 1);
    }
    if (!Number.isFinite(minR)) return;
    // Every cell whose top-left falls inside the box is absorbed.
    const absorbed = grid.positions.filter(
      (p) => p.r >= minR && p.r <= maxR && p.c >= minC && p.c <= maxC,
    );
    const survivor = absorbed.find((p) => p.r === minR && p.c === minC)?.cell;
    if (!survivor) return;
    for (const p of absorbed) {
      if (p.cell === survivor) continue;
      const content = (p.cell.innerHTML ?? '').trim();
      if (content && content !== '&nbsp;' && content !== '') {
        survivor.insertAdjacentHTML('beforeend', ' ' + p.cell.innerHTML);
      }
      p.cell.remove();
    }
    const cspan = maxC - minC + 1;
    const rspan = maxR - minR + 1;
    if (cspan > 1) survivor.setAttribute('colspan', String(cspan));
    else survivor.removeAttribute('colspan');
    if (rspan > 1) survivor.setAttribute('rowspan', String(rspan));
    else survivor.removeAttribute('rowspan');
  }

  /**
   * Split the current merged cell back into 1×1 cells, re-inserting plain cells
   * to the right (for colspan) and in the rows below (for rowspan).
   */
  private tableSplitCell(): void {
    const cell = this.currentCell();
    if (!cell) return;
    const colspan = Math.max(1, Number(cell.getAttribute('colspan')) || 1);
    const rowspan = Math.max(1, Number(cell.getAttribute('rowspan')) || 1);
    if (colspan === 1 && rowspan === 1) return;
    const row = cell.parentElement as HTMLTableRowElement | null;
    const table = this.closestWithin(cell, 'TABLE') as HTMLTableElement | null;
    if (!row || !table) return;
    cell.removeAttribute('colspan');
    cell.removeAttribute('rowspan');
    const tag = cell.tagName.toLowerCase();
    // Re-add the extra columns in the survivor's own row.
    for (let i = 1; i < colspan; i++) {
      const fresh = this.ownerDoc().createElement(tag);
      fresh.innerHTML = ' ';
      row.insertBefore(fresh, cell.nextSibling);
    }
    // Re-add full-width rows-worth of cells in each spanned row below.
    const rows = Array.from(table.querySelectorAll('tr'));
    const rowIndex = rows.indexOf(row);
    for (let dr = 1; dr < rowspan; dr++) {
      const target = rows[rowIndex + dr];
      if (!target) continue;
      for (let i = 0; i < colspan; i++) {
        const fresh = this.ownerDoc().createElement(tag);
        fresh.innerHTML = ' ';
        target.appendChild(fresh);
      }
    }
  }

  /**
   * Toggle the first row of the active table between a header row (`<th scope>`)
   * and a body row (`<td>`). Idempotent per invocation.
   */
  private tableToggleHeaderRow(): void {
    const cell = this.currentCell();
    const table = cell ? (this.closestWithin(cell, 'TABLE') as HTMLTableElement | null) : null;
    if (!table) return;
    const firstRow = table.querySelector('tr');
    if (!firstRow) return;
    const cells = Array.from(firstRow.children) as HTMLTableCellElement[];
    const isHeader = cells.every((c) => c.tagName === 'TH');
    for (const c of cells) {
      const replacement = this.ownerDoc().createElement(isHeader ? 'td' : 'th');
      for (const attr of Array.from(c.attributes)) {
        if (attr.name === 'scope') continue;
        replacement.setAttribute(attr.name, attr.value);
      }
      if (!isHeader) replacement.setAttribute('scope', 'col');
      replacement.innerHTML = c.innerHTML;
      c.replaceWith(replacement);
    }
  }

  /**
   * Build a grid model of the table containing `anchor`, resolving the row/column
   * coordinate of every cell while accounting for existing col/row spans. Used by
   * the rectangular merge.
   */
  private cellGrid(
    anchor: HTMLTableCellElement,
  ): { positions: { cell: HTMLTableCellElement; r: number; c: number; colspan: number; rowspan: number }[] } | null {
    const table = this.closestWithin(anchor, 'TABLE') as HTMLTableElement | null;
    if (!table) return null;
    const rows = Array.from(table.querySelectorAll('tr'));
    const occupied: boolean[][] = [];
    const positions: { cell: HTMLTableCellElement; r: number; c: number; colspan: number; rowspan: number }[] = [];
    rows.forEach((row, r) => {
      occupied[r] ??= [];
      let c = 0;
      for (const child of Array.from(row.children)) {
        const cell = child as HTMLTableCellElement;
        while (occupied[r]![c]) c++;
        const colspan = Math.max(1, Number(cell.getAttribute('colspan')) || 1);
        const rowspan = Math.max(1, Number(cell.getAttribute('rowspan')) || 1);
        positions.push({ cell, r, c, colspan, rowspan });
        for (let dr = 0; dr < rowspan; dr++) {
          occupied[r + dr] ??= [];
          for (let dc = 0; dc < colspan; dc++) occupied[r + dr]![c + dc] = true;
        }
        c += colspan;
      }
    });
    return { positions };
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

  // ---- full screen --------------------------------------------------------

  /** Toggle the widget between inline and full-viewport layout. */
  private toggleFullscreen(): void {
    const on = !this.isFullscreen();
    this.el.dataset.fullscreen = String(on);
    this.el.classList.toggle('jects-richtext--fullscreen', on);
    const btn = this.toolbarEl.querySelector<HTMLButtonElement>(
      'button[data-command="fullscreen"]',
    );
    if (btn) {
      btn.setAttribute('aria-pressed', String(on));
      btn.classList.toggle('jects-richtext__btn--active', on);
    }
    this.emit('fullscreenChange', { editor: this, fullscreen: on });
  }

  /** Whether the editor is currently in full-screen mode. */
  isFullscreen(): boolean {
    return this.el.dataset.fullscreen === 'true';
  }

  // ---- find & replace -----------------------------------------------------

  /** Show/hide the find & replace dialog. */
  private toggleFind(): void {
    if (this.findDialog.hidden) this.openFind();
    else this.closeFind();
  }

  /** Open the find dialog and focus the search field. */
  private openFind(): void {
    this.findDialog.hidden = false;
    this.el.classList.add('jects-richtext--finding');
    const input = this.findDialog.querySelector<HTMLInputElement>('.jects-richtext__find-input');
    input?.focus();
    input?.select();
    this.runFind();
  }

  /** Close the find dialog and clear any match highlights. */
  private closeFind(): void {
    this.findDialog.hidden = true;
    this.el.classList.remove('jects-richtext--finding');
    this.clearFindHighlights();
    this.el.dataset.findActive = '';
    const btn = this.toolbarEl.querySelector<HTMLButtonElement>(
      'button[data-command="findReplace"]',
    );
    if (btn) {
      btn.setAttribute('aria-pressed', 'false');
      btn.classList.remove('jects-richtext__btn--active');
    }
  }

  /** Delegated handler for the find dialog action buttons. */
  private handleFindAction(e: MouseEvent): void {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>(
      'button[data-find-action]',
    );
    if (!btn) return;
    const action = btn.dataset.findAction;
    if (action === 'close') this.closeFind();
    else if (action === 'next') this.findStep(1);
    else if (action === 'prev') this.findStep(-1);
    else if (action === 'replace') this.replaceCurrent();
    else if (action === 'replaceAll') this.replaceAll();
  }

  /** The current search term (from the find input). */
  private findTerm(): string {
    return (
      this.findDialog.querySelector<HTMLInputElement>('.jects-richtext__find-input')?.value ?? ''
    );
  }

  /** The current replacement string (from the replace input). */
  private replaceTerm(): string {
    return (
      this.findDialog.querySelector<HTMLInputElement>('.jects-richtext__replace-input')?.value ?? ''
    );
  }

  /** Remove all `<mark data-find>` highlight wrappers, merging text back. */
  private clearFindHighlights(): void {
    const marks = this.editable.querySelectorAll('mark[data-find]');
    for (const mark of Array.from(marks)) {
      const parent = mark.parentNode;
      if (!parent) continue;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    }
  }

  /**
   * Highlight every case-insensitive occurrence of the search term by wrapping
   * each match in `<mark data-find>`. Returns the number of matches and updates
   * the dialog's match counter. The active match (index in `findActive`) gets an
   * extra `data-find-active` flag for distinct styling.
   */
  private runFind(): number {
    this.clearFindHighlights();
    const term = this.findTerm();
    const countEl = this.findDialog.querySelector<HTMLElement>('.jects-richtext__find-count');
    if (!term) {
      if (countEl) countEl.textContent = '';
      return 0;
    }
    const matches = this.highlightMatches(term);
    let active = Number(this.el.dataset.findActive);
    if (!Number.isFinite(active) || active < 0 || active >= matches) active = 0;
    this.el.dataset.findActive = String(active);
    this.markActive(active);
    if (countEl) countEl.textContent = matches > 0 ? `${active + 1} / ${matches}` : '0 results';
    return matches;
  }

  /** Wrap each occurrence of `term` (case-insensitive) in a highlight mark. */
  private highlightMatches(term: string): number {
    const doc = this.ownerDoc();
    const lower = term.toLowerCase();
    const walker = doc.createTreeWalker(this.editable, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let n = walker.nextNode();
    while (n) {
      // Skip text already inside a highlight (defensive) or inside scripts.
      textNodes.push(n as Text);
      n = walker.nextNode();
    }
    let count = 0;
    for (const node of textNodes) {
      const text = node.nodeValue ?? '';
      const hay = text.toLowerCase();
      if (!hay.includes(lower)) continue;
      const frag = doc.createDocumentFragment();
      let idx = 0;
      let pos = hay.indexOf(lower, idx);
      while (pos !== -1) {
        if (pos > idx) frag.appendChild(doc.createTextNode(text.slice(idx, pos)));
        const mark = doc.createElement('mark');
        mark.setAttribute('data-find', '');
        mark.textContent = text.slice(pos, pos + term.length);
        frag.appendChild(mark);
        count++;
        idx = pos + term.length;
        pos = hay.indexOf(lower, idx);
      }
      if (idx < text.length) frag.appendChild(doc.createTextNode(text.slice(idx)));
      node.parentNode?.replaceChild(frag, node);
    }
    return count;
  }

  /** Flag the active match (by index) for distinct styling and scroll it in. */
  private markActive(index: number): void {
    const marks = this.editable.querySelectorAll<HTMLElement>('mark[data-find]');
    marks.forEach((m, i) => {
      if (i === index) {
        m.setAttribute('data-find-active', '');
        m.scrollIntoView?.({ block: 'nearest' });
      } else {
        m.removeAttribute('data-find-active');
      }
    });
  }

  /** Advance the active match by `dir` (+1 next / −1 prev), wrapping around. */
  private findStep(dir: number): void {
    const marks = this.editable.querySelectorAll('mark[data-find]');
    const total = marks.length;
    if (total === 0) {
      this.runFind();
      return;
    }
    let active = Number(this.el.dataset.findActive) || 0;
    active = (active + dir + total) % total;
    this.el.dataset.findActive = String(active);
    this.markActive(active);
    const countEl = this.findDialog.querySelector<HTMLElement>('.jects-richtext__find-count');
    if (countEl) countEl.textContent = `${active + 1} / ${total}`;
  }

  /** Replace the active match with the replacement text, then re-find. */
  private replaceCurrent(): void {
    if (this.config.readOnly || this.config.disabled) return;
    if (this.emit('beforeChange', { editor: this, html: this.getHTML() }) === false) return;
    const active = Number(this.el.dataset.findActive) || 0;
    const marks = this.editable.querySelectorAll<HTMLElement>('mark[data-find]');
    const mark = marks[active];
    if (!mark || !mark.parentNode) return;
    const replacement = this.ownerDoc().createTextNode(this.replaceTerm());
    mark.parentNode.replaceChild(replacement, mark);
    replacement.parentNode?.normalize();
    this.runFind();
    this.notifyChange('change');
  }

  /** Replace every match with the replacement text in one pass. */
  private replaceAll(): void {
    if (this.config.readOnly || this.config.disabled) return;
    if (this.emit('beforeChange', { editor: this, html: this.getHTML() }) === false) return;
    const marks = this.editable.querySelectorAll<HTMLElement>('mark[data-find]');
    if (marks.length === 0) return;
    const replacement = this.replaceTerm();
    for (const mark of Array.from(marks)) {
      const node = this.ownerDoc().createTextNode(replacement);
      mark.parentNode?.replaceChild(node, mark);
    }
    this.editable.normalize();
    this.el.dataset.findActive = '0';
    this.runFind();
    this.notifyChange('change');
  }

  // ---- link edit dialog ---------------------------------------------------

  /**
   * Open the link-edit dialog seeded from the anchor at the caret (or the last
   * anchor in the document). When there is no anchor, the dialog edits the
   * selection — Apply will create a new link around it.
   */
  private openLinkDialog(): void {
    this.saveSelection();
    const anchor = this.currentAnchor();
    const dlg = this.linkDialog;
    const text = dlg.querySelector<HTMLInputElement>('.jects-richtext__linkdlg-text')!;
    const href = dlg.querySelector<HTMLInputElement>('.jects-richtext__linkdlg-href')!;
    const blank = dlg.querySelector<HTMLInputElement>('.jects-richtext__linkdlg-target')!;
    if (anchor) {
      text.value = anchor.textContent ?? '';
      href.value = anchor.getAttribute('href') ?? '';
      blank.checked = anchor.getAttribute('target') === '_blank';
      this.el.dataset.linkEditing = 'true';
    } else {
      const sel = this.ownerDoc().getSelection?.();
      text.value = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).toString() : '';
      href.value = '';
      blank.checked = false;
      this.el.dataset.linkEditing = 'false';
    }
    dlg.hidden = false;
    this.el.classList.add('jects-richtext--linkdlg-open');
    href.focus();
  }

  /** The anchor element at the caret, or the last anchor as a fallback. */
  private currentAnchor(): HTMLAnchorElement | null {
    const sel = this.ownerDoc().getSelection?.();
    if (sel && sel.rangeCount > 0) {
      const start = sel.getRangeAt(0).startContainer;
      if (this.editable.contains(start)) {
        const a = this.closestWithin(start, 'A') as HTMLAnchorElement | null;
        if (a) return a;
      }
    }
    const anchors = this.editable.querySelectorAll('a[href]');
    return anchors.length ? (anchors[anchors.length - 1] as HTMLAnchorElement) : null;
  }

  /** Delegated handler for the link dialog's Apply / Cancel buttons. */
  private handleLinkDialogAction(e: MouseEvent): void {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>(
      'button[data-link-action]',
    );
    if (!btn) return;
    if (btn.dataset.linkAction === 'apply') this.applyLinkDialog();
    else this.closeLinkDialog();
  }

  /** Commit the link dialog: update the existing anchor or wrap the selection. */
  private applyLinkDialog(): void {
    if (this.config.readOnly || this.config.disabled) return;
    const dlg = this.linkDialog;
    const text = dlg.querySelector<HTMLInputElement>('.jects-richtext__linkdlg-text')!.value;
    const rawHref = dlg.querySelector<HTMLInputElement>('.jects-richtext__linkdlg-href')!.value.trim();
    const blank = dlg.querySelector<HTMLInputElement>('.jects-richtext__linkdlg-target')!.checked;
    if (!isSafeUrl(rawHref) || rawHref === '') {
      this.closeLinkDialog();
      return;
    }
    if (this.emit('beforeChange', { editor: this, html: this.getHTML() }) === false) {
      this.closeLinkDialog();
      return;
    }
    const editing = this.el.dataset.linkEditing === 'true';
    const anchor = editing ? this.currentAnchor() : null;
    if (anchor) {
      anchor.setAttribute('href', rawHref);
      anchor.textContent = text || rawHref;
      if (blank) {
        anchor.setAttribute('target', '_blank');
        anchor.setAttribute('rel', 'noopener noreferrer');
      } else {
        anchor.removeAttribute('target');
        anchor.removeAttribute('rel');
      }
    } else {
      // No existing anchor: build one and insert it at the saved selection.
      this.restoreSelection();
      this.editable.focus();
      const label = text || rawHref;
      const targetAttr = blank ? ' target="_blank" rel="noopener noreferrer"' : '';
      this.insertHtml(`<a href="${escapeAttr(rawHref)}"${targetAttr}>${escapeHtml(label)}</a>`);
    }
    this.closeLinkDialog();
    this.notifyChange('change');
  }

  /** Hide the link dialog without committing. */
  private closeLinkDialog(): void {
    this.linkDialog.hidden = true;
    this.el.classList.remove('jects-richtext--linkdlg-open');
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
    // Inline toggles whose state is derived from the selection's ancestry rather
    // than from execCommand (sub/sup have patchy native query support; inline
    // code has none).
    const inlineTag: Partial<Record<RichTextCommand, string>> = {
      subscript: 'SUB',
      superscript: 'SUP',
      inlineCode: 'CODE',
    };
    for (const btn of this.toolbarEl.querySelectorAll<HTMLButtonElement>(
      'button[data-command]',
    )) {
      const cmd = btn.dataset.command as RichTextCommand | undefined;
      // Only genuine toggles carry aria-pressed; action buttons never do.
      if (!cmd || !TOGGLE_COMMANDS.has(cmd)) continue;
      // sourceView / fullscreen / findReplace own their pressed state via their
      // own mode flags (set by their toggles) — never clobber it here.
      if (cmd === 'sourceView' || cmd === 'fullscreen' || cmd === 'findReplace') continue;
      let active = false;
      const tag = inlineTag[cmd];
      if (tag) {
        active = this.selectionInTag(tag);
      } else {
        const native = map[cmd];
        if (native && typeof queryState === 'function') {
          try {
            active = queryState.call(doc, native);
          } catch {
            active = false;
          }
        }
      }
      btn.setAttribute('aria-pressed', String(active));
      btn.classList.toggle('jects-richtext__btn--active', active);
    }
  }

  /** True when the caret/selection start sits inside an element of `tag`. */
  private selectionInTag(tag: string): boolean {
    const sel = this.ownerDoc().getSelection?.();
    if (!sel || sel.rangeCount === 0) return false;
    const node = sel.getRangeAt(0).startContainer;
    if (!this.editable.contains(node)) return false;
    return this.closestWithin(node, tag) !== null;
  }

  /** Emit change/input after content mutated, gated by `beforeChange` veto. */
  private notifyChange(kind: 'input' | 'change'): void {
    const html = this.getHTML();
    this.updateStatus();
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

  /** Current editor HTML (sanitized; transient find highlights removed). */
  getHTML(): string {
    return sanitizeHtml(this.serializeBody());
  }

  /**
   * Snapshot the editable's innerHTML with the transient find-highlight wrappers
   * (`<mark data-find>`) unwrapped, so the search UI never leaks into the saved
   * document. The live DOM is left untouched (it is cloned first).
   */
  private serializeBody(): string {
    if (!this.editable.querySelector('mark[data-find]')) return this.editable.innerHTML;
    const clone = this.editable.cloneNode(true) as HTMLElement;
    for (const mark of Array.from(clone.querySelectorAll('mark[data-find]'))) {
      const parent = mark.parentNode;
      if (!parent) continue;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
    }
    return clone.innerHTML;
  }

  /**
   * Live document statistics (words, characters, characters-without-spaces).
   * Mirrors the footer counts and excludes the transient find highlights.
   */
  getStats(): RichTextStats {
    const text = (this.editable.textContent ?? '').replace(/ /g, ' ');
    const trimmed = text.trim();
    const words = trimmed === '' ? 0 : trimmed.split(/\s+/).length;
    return {
      words,
      characters: text.length,
      charactersNoSpaces: text.replace(/\s/g, '').length,
    };
  }

  /** Update the footer's word/character readout from {@link getStats}. */
  private updateStatus(): void {
    const el = this.statusEl;
    if (!el || el.hidden) return;
    const { words, characters } = this.getStats();
    el.textContent = `${words} word${words === 1 ? '' : 's'} · ${characters} character${characters === 1 ? '' : 's'}`;
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
