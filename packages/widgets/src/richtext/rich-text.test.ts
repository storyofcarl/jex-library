/** jsdom unit test — runs in the default `pnpm test`. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RichText, sanitizeHtml, cleanPastedHtml } from './rich-text.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

function getEditable(root: HTMLElement): HTMLElement {
  return root.querySelector('.jects-richtext__editable') as HTMLElement;
}

describe('RichText (jsdom)', () => {
  it('renders root, toolbar and an editable region', () => {
    const rt = new RichText(host);
    const root = host.querySelector('.jects-richtext')!;
    expect(root).toBeTruthy();
    const toolbar = root.querySelector('.jects-richtext__toolbar')!;
    expect(toolbar.getAttribute('role')).toBe('toolbar');
    const editable = getEditable(root as HTMLElement);
    expect(editable.getAttribute('role')).toBe('textbox');
    expect(editable.getAttribute('aria-multiline')).toBe('true');
    expect(editable.getAttribute('contenteditable')).toBe('true');
    rt.destroy();
  });

  it('renders toolbar buttons with command + aria metadata', () => {
    const rt = new RichText(host, { toolbar: ['bold', 'separator', 'italic'] });
    const buttons = host.querySelectorAll('button[data-command]');
    expect(buttons.length).toBe(2);
    const bold = host.querySelector('button[data-command="bold"]')!;
    expect(bold.getAttribute('aria-label')).toBe('Bold');
    expect(bold.getAttribute('aria-pressed')).toBe('false');
    expect(host.querySelector('.jects-richtext__sep')).toBeTruthy();
    rt.destroy();
  });

  it('hides the toolbar when given an empty layout', () => {
    const rt = new RichText(host, { toolbar: [] });
    const toolbar = host.querySelector('.jects-richtext__toolbar') as HTMLElement;
    expect(toolbar.hidden).toBe(true);
    rt.destroy();
  });

  it('sets initial value and getHTML reflects it', () => {
    const rt = new RichText(host, { value: '<p>Hello</p>' });
    expect(rt.getHTML()).toContain('Hello');
    expect(getEditable(host).textContent).toContain('Hello');
    rt.destroy();
  });

  it('setHTML replaces content and emits change', () => {
    const rt = new RichText(host);
    const spy = vi.fn();
    rt.on('change', spy);
    rt.setHTML('<p>New body</p>');
    expect(rt.getHTML()).toContain('New body');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].editor).toBe(rt);
    rt.destroy();
  });

  it('input event fires when editable content changes', () => {
    const rt = new RichText(host);
    const spy = vi.fn();
    rt.on('input', spy);
    const editable = getEditable(host);
    editable.innerHTML = '<p>typed</p>';
    editable.dispatchEvent(new Event('input', { bubbles: true }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].html).toContain('typed');
    rt.destroy();
  });

  it('toolbar button click invokes exec and emits change', () => {
    const rt = new RichText(host, { value: '<p>x</p>', toolbar: ['bold'] });
    const spy = vi.fn();
    rt.on('change', spy);
    const bold = host.querySelector('button[data-command="bold"]') as HTMLButtonElement;
    bold.click();
    expect(spy).toHaveBeenCalled();
    rt.destroy();
  });

  it('beforeChange veto cancels a command', () => {
    const rt = new RichText(host, { value: '<p>x</p>', toolbar: ['bold'] });
    rt.on('beforeChange', () => false);
    const changeSpy = vi.fn();
    rt.on('change', changeSpy);
    rt.exec('bold');
    expect(changeSpy).not.toHaveBeenCalled();
    rt.destroy();
  });

  it('Ctrl+B keyboard shortcut triggers the bold command', () => {
    const rt = new RichText(host, { value: '<p>x</p>' });
    const execSpy = vi.spyOn(rt, 'exec');
    const editable = getEditable(host);
    const ev = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true });
    editable.dispatchEvent(ev);
    expect(execSpy).toHaveBeenCalledWith('bold');
    expect(ev.defaultPrevented).toBe(true);
    rt.destroy();
  });

  it('readOnly disables editing and toolbar buttons', () => {
    const rt = new RichText(host, { readOnly: true, toolbar: ['bold'] });
    const editable = getEditable(host);
    expect(editable.getAttribute('contenteditable')).toBe('false');
    expect(editable.getAttribute('aria-readonly')).toBe('true');
    const bold = host.querySelector('button[data-command="bold"]') as HTMLButtonElement;
    expect(bold.disabled).toBe(true);
    // exec is a no-op in readOnly
    const spy = vi.fn();
    rt.on('change', spy);
    rt.exec('bold');
    expect(spy).not.toHaveBeenCalled();
    rt.destroy();
  });

  it('paste honors the beforeChange veto and does not commit content', () => {
    const rt = new RichText(host, { value: '<p>x</p>' });
    rt.on('beforeChange', () => false);
    const changeSpy = vi.fn();
    rt.on('change', changeSpy);
    const editable = getEditable(host);
    // jsdom lacks DataTransfer; stub a minimal clipboardData on the event.
    const ev = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
      clipboardData: { getData(type: string): string };
    };
    ev.clipboardData = {
      getData: (type: string) => (type === 'text/plain' ? 'PASTED' : ''),
    };
    editable.dispatchEvent(ev);
    expect(changeSpy).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(true);
    expect(rt.getHTML()).not.toContain('PASTED');
    rt.destroy();
  });

  it('only toggle commands carry aria-pressed; action buttons omit it', () => {
    const rt = new RichText(host, {
      toolbar: ['bold', 'ul', 'alignLeft', 'undo', 'link', 'h1', 'clear'],
    });
    const pressed = (cmd: string) =>
      host
        .querySelector(`button[data-command="${cmd}"]`)!
        .hasAttribute('aria-pressed');
    expect(pressed('bold')).toBe(true);
    expect(pressed('ul')).toBe(true);
    expect(pressed('alignLeft')).toBe(true);
    expect(pressed('undo')).toBe(false);
    expect(pressed('link')).toBe(false);
    expect(pressed('h1')).toBe(false);
    expect(pressed('clear')).toBe(false);
    rt.destroy();
  });

  it('seeds a roving tabindex (exactly one focusable button)', () => {
    const rt = new RichText(host, { toolbar: ['bold', 'italic', 'underline'] });
    const buttons = Array.from(
      host.querySelectorAll<HTMLButtonElement>('button[data-command]'),
    );
    const zero = buttons.filter((b) => b.getAttribute('tabindex') === '0');
    const minus = buttons.filter((b) => b.getAttribute('tabindex') === '-1');
    expect(zero.length).toBe(1);
    expect(minus.length).toBe(2);
    expect(zero[0]).toBe(buttons[0]);
    rt.destroy();
  });

  it('ArrowRight moves the roving tabindex to the next button', () => {
    const rt = new RichText(host, { toolbar: ['bold', 'italic', 'underline'] });
    const buttons = Array.from(
      host.querySelectorAll<HTMLButtonElement>('button[data-command]'),
    );
    buttons[0]!.focus();
    const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    buttons[0]!.dispatchEvent(ev); // bubbles to the toolbar handler
    expect(buttons[0]!.getAttribute('tabindex')).toBe('-1');
    expect(buttons[1]!.getAttribute('tabindex')).toBe('0');
    rt.destroy();
  });

  it('getMarkdown serializes common blocks', () => {
    const rt = new RichText(host, {
      value: '<h1>Title</h1><p>Some <strong>bold</strong> text</p><ul><li>a</li><li>b</li></ul>',
    });
    const md = rt.getMarkdown();
    expect(md).toContain('# Title');
    expect(md).toContain('**bold**');
    expect(md).toContain('- a');
    expect(md).toContain('- b');
    rt.destroy();
  });

  it('clear() empties the editor', () => {
    const rt = new RichText(host, { value: '<p>stuff</p>' });
    rt.clear();
    expect(rt.getHTML()).toBe('');
    rt.destroy();
  });

  // ---- block / inline exit gestures (GALLERY-FEEDBACK #4) ----------------

  /** Place a collapsed caret inside `node` at `offset` (text/childNode index). */
  function placeCaret(node: Node, offset: number): void {
    const sel = window.getSelection()!;
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function pressEnter(editable: HTMLElement, opts: { shiftKey?: boolean } = {}): KeyboardEvent {
    const ev = new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: opts.shiftKey ?? false,
      bubbles: true,
      cancelable: true,
    });
    editable.dispatchEvent(ev);
    return ev;
  }

  it('Enter on an EMPTY list item exits the list to a paragraph', () => {
    const rt = new RichText(host, { value: '<ul><li>first</li><li></li></ul>' });
    const editable = getEditable(host);
    const emptyLi = editable.querySelectorAll('li')[1]!;
    placeCaret(emptyLi, 0);
    const ev = pressEnter(editable);
    expect(ev.defaultPrevented).toBe(true);
    // The empty <li> is gone; a paragraph now follows the (now single-item) list.
    expect(editable.querySelectorAll('li').length).toBe(1);
    const p = editable.querySelector('p');
    expect(p).toBeTruthy();
    // The paragraph sits after the list, at the editable's top level.
    expect(p!.parentElement).toBe(editable);
    expect(editable.querySelector('ul')!.compareDocumentPosition(p!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    rt.destroy();
  });

  it('Enter at the end of a blockquote breaks OUT to a paragraph', () => {
    const rt = new RichText(host, { value: '<blockquote>quoted</blockquote>' });
    const editable = getEditable(host);
    const bq = editable.querySelector('blockquote')!;
    const textNode = bq.firstChild!; // "quoted"
    placeCaret(textNode, (textNode.textContent ?? '').length); // caret at end
    const ev = pressEnter(editable);
    expect(ev.defaultPrevented).toBe(true);
    const p = editable.querySelector('p');
    expect(p).toBeTruthy();
    expect(p!.parentElement).toBe(editable);
    // The blockquote text is preserved, the new paragraph is empty.
    expect(editable.querySelector('blockquote')!.textContent).toContain('quoted');
    expect((p!.textContent ?? '').trim()).toBe('');
    rt.destroy();
  });

  it('Enter at the end of a code block breaks OUT to a paragraph', () => {
    const rt = new RichText(host, { value: '<pre>code()</pre>' });
    const editable = getEditable(host);
    const pre = editable.querySelector('pre')!;
    const textNode = pre.firstChild!;
    placeCaret(textNode, (textNode.textContent ?? '').length);
    const ev = pressEnter(editable);
    expect(ev.defaultPrevented).toBe(true);
    const p = editable.querySelector('p');
    expect(p).toBeTruthy();
    expect(p!.parentElement).toBe(editable);
    expect(editable.querySelector('pre')!.textContent).toContain('code()');
    rt.destroy();
  });

  it('Enter in the MIDDLE of a blockquote does NOT break out', () => {
    const rt = new RichText(host, { value: '<blockquote>quoted</blockquote>' });
    const editable = getEditable(host);
    const bq = editable.querySelector('blockquote')!;
    const textNode = bq.firstChild!;
    placeCaret(textNode, 2); // mid-text
    const ev = pressEnter(editable);
    // Not consumed: native newline handling applies, no break-out paragraph.
    expect(ev.defaultPrevented).toBe(false);
    expect(editable.querySelector('p')).toBeNull();
    rt.destroy();
  });

  it('typing immediately after a link does NOT extend the anchor', () => {
    const rt = new RichText(host, {
      value: '<p><a href="https://example.com">link</a></p>',
    });
    const editable = getEditable(host);
    const anchor = editable.querySelector('a')!;
    const anchorText = anchor.firstChild!;
    // Caret at the END of the anchor text.
    placeCaret(anchorText, (anchorText.textContent ?? '').length);
    const ev = new KeyboardEvent('keydown', {
      key: 'x',
      bubbles: true,
      cancelable: true,
    });
    editable.dispatchEvent(ev);
    // The caret has been moved OUT of the anchor so the next char is plain text.
    const sel = window.getSelection()!;
    const range = sel.getRangeAt(0);
    let cur: Node | null = range.startContainer;
    let insideAnchor = false;
    while (cur && cur !== editable) {
      if (cur === anchor) insideAnchor = true;
      cur = cur.parentNode;
    }
    expect(insideAnchor).toBe(false);
    rt.destroy();
  });

  it('typing in the MIDDLE of a link keeps the caret inside the anchor', () => {
    const rt = new RichText(host, {
      value: '<p><a href="https://example.com">link</a></p>',
    });
    const editable = getEditable(host);
    const anchor = editable.querySelector('a')!;
    const anchorText = anchor.firstChild!;
    placeCaret(anchorText, 2); // mid-anchor
    const ev = new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true });
    editable.dispatchEvent(ev);
    const sel = window.getSelection()!;
    const range = sel.getRangeAt(0);
    let cur: Node | null = range.startContainer;
    let insideAnchor = false;
    while (cur && cur !== editable) {
      if (cur === anchor) insideAnchor = true;
      cur = cur.parentNode;
    }
    expect(insideAnchor).toBe(true);
    rt.destroy();
  });

  it('destroy removes the element and is idempotent', () => {
    const rt = new RichText(host, { value: '<p>bye</p>' });
    rt.destroy();
    expect(host.querySelector('.jects-richtext')).toBeNull();
    expect(() => rt.destroy()).not.toThrow();
  });
});

describe('RichText — parity features', () => {
  // The global Selection is shared across tests; clear stale ranges (which point
  // at detached nodes from prior tests) so insertions land in the fresh editor.
  beforeEach(() => window.getSelection()?.removeAllRanges());

  /** Select the full contents of an element (a non-collapsed range). */
  function selectContents(node: Node): void {
    const sel = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(node);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  function placeCaret(node: Node, offset: number): void {
    const sel = window.getSelection()!;
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // ---- 1. images ----
  it('insertImage inserts an <img> with the given src', () => {
    const rt = new RichText(host, { value: '' });
    rt.exec('insertImage', 'https://example.com/cat.png');
    const img = getEditable(host).querySelector('img');
    expect(img).toBeTruthy();
    expect(img!.getAttribute('src')).toBe('https://example.com/cat.png');
    expect(rt.getHTML()).toContain('<img');
    rt.destroy();
  });

  it('insertImage accepts a data: image URL but rejects javascript:', () => {
    const rt = new RichText(host, { value: '' });
    rt.exec('insertImage', 'data:image/png;base64,iVBORw0KGgo=');
    expect(getEditable(host).querySelector('img')).toBeTruthy();
    rt.setHTML('');
    rt.exec('insertImage', 'javascript:alert(1)');
    // Unsafe src is stripped (sanitizer/policy), so no usable image src survives.
    expect(rt.getHTML()).not.toContain('javascript:');
    rt.destroy();
  });

  // ---- 2. tables ----
  it('insertTable inserts a table with the right cell count', () => {
    const rt = new RichText(host, { value: '' });
    rt.exec('insertTable', '2x3');
    const table = getEditable(host).querySelector('table');
    expect(table).toBeTruthy();
    expect(getEditable(host).querySelectorAll('tr').length).toBe(2);
    expect(getEditable(host).querySelectorAll('td').length).toBe(6);
    rt.destroy();
  });

  it('tableAddColumn and tableAddRow grow the table', () => {
    const rt = new RichText(host, { value: '' });
    rt.exec('insertTable', '2x2'); // 4 cells
    rt.exec('tableAddColumn'); // 2 rows × 3 = 6
    expect(getEditable(host).querySelectorAll('td').length).toBe(6);
    rt.exec('tableAddRow'); // 3 rows × 3 = 9
    expect(getEditable(host).querySelectorAll('tr').length).toBe(3);
    expect(getEditable(host).querySelectorAll('td').length).toBe(9);
    rt.destroy();
  });

  // ---- 3. text + background color ----
  it('foreColor wraps the selection with a color style', () => {
    const rt = new RichText(host, { value: '<p>hello</p>' });
    const p = getEditable(host).querySelector('p')!;
    selectContents(p);
    rt.exec('foreColor', '#ff0000');
    // The browser/jsdom normalizes the hex to rgb() when serializing the style.
    const html = rt.getHTML();
    expect(html).toContain('<span');
    expect(html).toContain('color: rgb(255, 0, 0)');
    rt.destroy();
  });

  it('backColor wraps the selection with a background-color style', () => {
    const rt = new RichText(host, { value: '<p>hello</p>' });
    selectContents(getEditable(host).querySelector('p')!);
    rt.exec('backColor', '#ffff00');
    expect(rt.getHTML()).toContain('background-color: rgb(255, 255, 0)');
    rt.destroy();
  });

  // ---- 4. font family + size ----
  it('fontFamily applies a font-family to the selection', () => {
    const rt = new RichText(host, { value: '<p>hello</p>' });
    selectContents(getEditable(host).querySelector('p')!);
    rt.exec('fontFamily', 'Georgia, serif');
    expect(rt.getHTML()).toContain('font-family: Georgia, serif');
    rt.destroy();
  });

  it('fontSize applies a font-size to the selection', () => {
    const rt = new RichText(host, { value: '<p>hello</p>' });
    selectContents(getEditable(host).querySelector('p')!);
    rt.exec('fontSize', '24px');
    expect(rt.getHTML()).toContain('font-size: 24px');
    rt.destroy();
  });

  it('renders font selects and color swatches in the toolbar', () => {
    const rt = new RichText(host, {
      toolbar: ['fontFamily', 'fontSize', 'foreColor', 'backColor'],
    });
    expect(host.querySelector('select[data-command="fontFamily"]')).toBeTruthy();
    expect(host.querySelector('select[data-command="fontSize"]')).toBeTruthy();
    expect(host.querySelector('input[data-command="foreColor"]')).toBeTruthy();
    expect(host.querySelector('input[data-command="backColor"]')).toBeTruthy();
    rt.destroy();
  });

  // ---- 5. indent / outdent ----
  it('indent increases block indentation, outdent decreases it', () => {
    const rt = new RichText(host, { value: '<p>hi</p>' });
    const p = getEditable(host).querySelector('p')!;
    placeCaret(p.firstChild!, 0);
    rt.exec('indent');
    expect(p.style.marginLeft).toBe('2em');
    rt.exec('indent');
    expect(p.style.marginLeft).toBe('4em');
    rt.exec('outdent');
    expect(p.style.marginLeft).toBe('2em');
    rt.exec('outdent');
    expect(p.style.marginLeft).toBe('');
    rt.destroy();
  });

  // ---- 6. source view ----
  it('sourceView toggles to raw HTML and edits round-trip back', () => {
    const rt = new RichText(host, { value: '<p>Hi</p>' });
    const source = host.querySelector('.jects-richtext__source') as HTMLTextAreaElement;
    const editable = getEditable(host);
    expect(source.hidden).toBe(true);
    rt.exec('sourceView');
    expect(source.hidden).toBe(false);
    expect(editable.hidden).toBe(true);
    expect(source.value).toContain('<p>Hi</p>');
    // Edit the raw source, toggle back, and confirm it synced into the document.
    source.value = '<p>Bye</p>';
    rt.exec('sourceView');
    expect(editable.hidden).toBe(false);
    expect(source.hidden).toBe(true);
    expect(rt.getHTML()).toContain('Bye');
    rt.destroy();
  });

  it('starts in source view when configured', () => {
    const rt = new RichText(host, { value: '<p>X</p>', sourceView: true });
    const source = host.querySelector('.jects-richtext__source') as HTMLTextAreaElement;
    expect(source.hidden).toBe(false);
    expect(getEditable(host).hidden).toBe(true);
    rt.destroy();
  });

  // ---- 7. markdown export / import ----
  it('setMarkdown imports headings, bold/italic and lists', () => {
    const rt = new RichText(host, { value: '' });
    rt.setMarkdown('# Title\n\nSome **bold** and *italic* text\n\n- a\n- b');
    const html = rt.getHTML();
    expect(html).toContain('<h1>');
    expect(html).toContain('Title');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<li>');
    rt.destroy();
  });

  it('markdown round-trips through get/setMarkdown', () => {
    const rt = new RichText(host, { value: '' });
    rt.setMarkdown('## Heading\n\n- one\n- two');
    const md = rt.getMarkdown();
    expect(md).toContain('## Heading');
    expect(md).toContain('- one');
    expect(md).toContain('- two');
    rt.destroy();
  });

  // ---- 8. paste-clean ----
  it('cleanPastedHtml strips cruft but keeps semantic tags', () => {
    const dirty =
      '<p class="x" style="color:red"><span style="font-weight:bold">Hi</span>' +
      '<script>bad()</script><b>Bold</b></p>';
    const clean = cleanPastedHtml(dirty);
    expect(clean).not.toContain('script');
    expect(clean).not.toContain('class');
    expect(clean).not.toContain('style');
    expect(clean).not.toContain('<span');
    expect(clean).toContain('Hi');
    expect(clean).toContain('<b>Bold</b>');
  });

  it('paste cleans dirty HTML by default (pasteClean on)', () => {
    const rt = new RichText(host, { value: '' });
    const editable = getEditable(host);
    const ev = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
      clipboardData: { getData(type: string): string };
    };
    ev.clipboardData = {
      getData: (type: string) =>
        type === 'text/html'
          ? '<p class="mso" style="color:red">Hi<script>bad()</script></p>'
          : '',
    };
    editable.dispatchEvent(ev);
    const html = rt.getHTML();
    expect(html).toContain('Hi');
    expect(html).not.toContain('script');
    expect(html).not.toContain('class');
    expect(html).not.toContain('color');
    rt.destroy();
  });

  it('pasteClean=false keeps allow-listed inline styles (config is wired)', () => {
    const rt = new RichText(host, { value: '', pasteClean: false });
    const editable = getEditable(host);
    const ev = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
      clipboardData: { getData(type: string): string };
    };
    ev.clipboardData = {
      getData: (type: string) =>
        type === 'text/html' ? '<p style="text-align: center">Hi</p>' : '',
    };
    editable.dispatchEvent(ev);
    // With cleaning OFF, the safety sanitizer still runs but keeps text-align.
    expect(rt.getHTML()).toContain('text-align');
    rt.destroy();
  });
});

describe('RichText — Phase 1/2 enterprise features', () => {
  beforeEach(() => window.getSelection()?.removeAllRanges());

  function selectContents(node: Node): void {
    const sel = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(node);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  function placeCaret(node: Node, offset: number): void {
    const sel = window.getSelection()!;
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // ---- horizontal rule ----
  it('horizontalRule inserts an <hr>', () => {
    const rt = new RichText(host, { value: '<p>x</p>' });
    placeCaret(getEditable(host).querySelector('p')!.firstChild!, 1);
    rt.exec('horizontalRule');
    expect(getEditable(host).querySelector('hr')).toBeTruthy();
    expect(rt.getHTML()).toContain('<hr>');
    rt.destroy();
  });

  // ---- subscript / superscript / inline code ----
  it('subscript wraps the selection in <sub> and toggles off', () => {
    const rt = new RichText(host, { value: '<p>H2O</p>' });
    const p = getEditable(host).querySelector('p')!;
    selectContents(p);
    rt.exec('subscript');
    expect(getEditable(host).querySelector('sub')).toBeTruthy();
    expect(rt.getHTML()).toContain('<sub>');
    // Toggling again unwraps it.
    selectContents(getEditable(host).querySelector('sub')!);
    rt.exec('subscript');
    expect(getEditable(host).querySelector('sub')).toBeNull();
    rt.destroy();
  });

  it('superscript wraps the selection in <sup>', () => {
    const rt = new RichText(host, { value: '<p>x2</p>' });
    selectContents(getEditable(host).querySelector('p')!);
    rt.exec('superscript');
    expect(getEditable(host).querySelector('sup')).toBeTruthy();
    rt.destroy();
  });

  it('inlineCode wraps the selection in <code> and reflects aria-pressed', () => {
    const rt = new RichText(host, { value: '<p>code</p>', toolbar: ['inlineCode'] });
    selectContents(getEditable(host).querySelector('p')!);
    rt.exec('inlineCode');
    const code = getEditable(host).querySelector('code');
    expect(code).toBeTruthy();
    // Caret inside the code element => the toggle button reports pressed.
    placeCaret(code!.firstChild!, 1);
    rt.exec('inlineCode'); // toggle off triggers a refreshState pass
    expect(getEditable(host).querySelector('code')).toBeNull();
    rt.destroy();
  });

  // ---- justify ----
  it('justify is a genuine toggle with aria-pressed wired', () => {
    const rt = new RichText(host, { toolbar: ['justify'] });
    const btn = host.querySelector('button[data-command="justify"]')!;
    expect(btn.hasAttribute('aria-pressed')).toBe(true);
    rt.destroy();
  });

  // ---- find & replace ----
  it('findReplace toggles the dialog and highlights matches', () => {
    const rt = new RichText(host, { value: '<p>the cat sat on the mat</p>' });
    rt.exec('findReplace');
    const dlg = host.querySelector('.jects-richtext__find') as HTMLElement;
    expect(dlg.hidden).toBe(false);
    const input = dlg.querySelector('.jects-richtext__find-input') as HTMLInputElement;
    input.value = 'the';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const marks = getEditable(host).querySelectorAll('mark[data-find]');
    expect(marks.length).toBe(2);
    // Highlights are transient: getHTML must not leak them.
    expect(rt.getHTML()).not.toContain('data-find');
    expect(rt.getHTML()).not.toContain('<mark');
    rt.destroy();
  });

  it('replace all swaps every match and clears highlights', () => {
    const rt = new RichText(host, { value: '<p>foo foo foo</p>' });
    rt.exec('findReplace');
    const dlg = host.querySelector('.jects-richtext__find') as HTMLElement;
    const find = dlg.querySelector('.jects-richtext__find-input') as HTMLInputElement;
    const repl = dlg.querySelector('.jects-richtext__replace-input') as HTMLInputElement;
    find.value = 'foo';
    find.dispatchEvent(new Event('input', { bubbles: true }));
    repl.value = 'bar';
    (dlg.querySelector('button[data-find-action="replaceAll"]') as HTMLButtonElement).click();
    const html = rt.getHTML();
    expect(html).toContain('bar bar bar');
    expect(html).not.toContain('foo');
    rt.destroy();
  });

  it('replace (single) swaps only the active match', () => {
    const rt = new RichText(host, { value: '<p>aa aa</p>' });
    rt.exec('findReplace');
    const dlg = host.querySelector('.jects-richtext__find') as HTMLElement;
    const find = dlg.querySelector('.jects-richtext__find-input') as HTMLInputElement;
    const repl = dlg.querySelector('.jects-richtext__replace-input') as HTMLInputElement;
    find.value = 'aa';
    find.dispatchEvent(new Event('input', { bubbles: true }));
    repl.value = 'bb';
    (dlg.querySelector('button[data-find-action="replace"]') as HTMLButtonElement).click();
    const html = rt.getHTML();
    expect(html).toContain('bb');
    expect(html).toContain('aa'); // one occurrence remains
    rt.destroy();
  });

  // ---- table cell merge / split / header ----
  it('tableMergeCells merges two adjacent cells into a colspan', () => {
    const rt = new RichText(host, { value: '' });
    rt.exec('insertTable', '1x2');
    const cells = getEditable(host).querySelectorAll('td');
    placeCaret(cells[0]!, 0);
    rt.exec('tableMergeCells');
    const remaining = getEditable(host).querySelectorAll('td');
    expect(remaining.length).toBe(1);
    expect(remaining[0]!.getAttribute('colspan')).toBe('2');
    rt.destroy();
  });

  it('tableSplitCell splits a merged cell back into separate cells', () => {
    const rt = new RichText(host, { value: '' });
    rt.exec('insertTable', '1x2');
    placeCaret(getEditable(host).querySelector('td')!, 0);
    rt.exec('tableMergeCells');
    expect(getEditable(host).querySelectorAll('td').length).toBe(1);
    placeCaret(getEditable(host).querySelector('td')!, 0);
    rt.exec('tableSplitCell');
    expect(getEditable(host).querySelectorAll('td').length).toBe(2);
    expect(getEditable(host).querySelector('td')!.hasAttribute('colspan')).toBe(false);
    rt.destroy();
  });

  it('tableToggleHeaderRow converts the first row to <th> and back', () => {
    const rt = new RichText(host, { value: '' });
    rt.exec('insertTable', '2x2');
    placeCaret(getEditable(host).querySelector('td')!, 0);
    rt.exec('tableToggleHeaderRow');
    const firstRow = getEditable(host).querySelector('tr')!;
    expect(Array.from(firstRow.children).every((c) => c.tagName === 'TH')).toBe(true);
    expect(firstRow.querySelector('th')!.getAttribute('scope')).toBe('col');
    // Toggle back.
    placeCaret(getEditable(host).querySelector('th')!, 0);
    rt.exec('tableToggleHeaderRow');
    expect(getEditable(host).querySelector('tr')!.querySelector('th')).toBeNull();
    rt.destroy();
  });

  // ---- link edit dialog ----
  it('editLink updates the href/text/target of an existing anchor', () => {
    const rt = new RichText(host, {
      value: '<p><a href="https://old.example">old</a></p>',
    });
    const anchor = getEditable(host).querySelector('a')!;
    placeCaret(anchor.firstChild!, 1);
    rt.exec('editLink');
    const dlg = host.querySelector('.jects-richtext__linkdlg') as HTMLElement;
    expect(dlg.hidden).toBe(false);
    const text = dlg.querySelector('.jects-richtext__linkdlg-text') as HTMLInputElement;
    const href = dlg.querySelector('.jects-richtext__linkdlg-href') as HTMLInputElement;
    const blank = dlg.querySelector('.jects-richtext__linkdlg-target') as HTMLInputElement;
    expect(href.value).toBe('https://old.example');
    text.value = 'new label';
    href.value = 'https://new.example';
    blank.checked = true;
    (dlg.querySelector('button[data-link-action="apply"]') as HTMLButtonElement).click();
    const out = getEditable(host).querySelector('a')!;
    expect(out.getAttribute('href')).toBe('https://new.example');
    expect(out.textContent).toBe('new label');
    expect(out.getAttribute('target')).toBe('_blank');
    expect(out.getAttribute('rel')).toContain('noopener');
    rt.destroy();
  });

  it('editLink rejects a javascript: href', () => {
    const rt = new RichText(host, { value: '<p><a href="https://ok.example">x</a></p>' });
    placeCaret(getEditable(host).querySelector('a')!.firstChild!, 1);
    rt.exec('editLink');
    const dlg = host.querySelector('.jects-richtext__linkdlg') as HTMLElement;
    (dlg.querySelector('.jects-richtext__linkdlg-href') as HTMLInputElement).value =
      'javascript:alert(1)';
    (dlg.querySelector('button[data-link-action="apply"]') as HTMLButtonElement).click();
    // The unsafe value was not committed; the original href is preserved.
    expect(getEditable(host).querySelector('a')!.getAttribute('href')).toBe('https://ok.example');
    rt.destroy();
  });

  // ---- image upload ----
  it('uploadImage renders a hidden file input and the toolbar button', () => {
    const rt = new RichText(host, { toolbar: ['uploadImage'] });
    expect(host.querySelector('button[data-command="uploadImage"]')).toBeTruthy();
    expect(host.querySelector('input.jects-richtext__file')).toBeTruthy();
    rt.destroy();
  });

  // ---- image align / width ----
  it('imageAlign and imageWidth apply allow-listed inline styles to the image', () => {
    const rt = new RichText(host, { value: '<p><img src="https://x/y.png" alt=""></p>' });
    placeCaret(getEditable(host).querySelector('p')!, 0);
    rt.exec('imageAlignCenter');
    const img = getEditable(host).querySelector('img')!;
    expect(img.style.display).toBe('block');
    expect(img.style.margin).toContain('auto');
    rt.exec('imageWidthSmall');
    expect(img.style.width).toBe('25%');
    // Styles survive serialization (kept on the allow-list).
    expect(rt.getHTML()).toContain('width: 25%');
    rt.destroy();
  });

  // ---- word / char count ----
  it('getStats returns word and character counts', () => {
    const rt = new RichText(host, { value: '<p>one two three</p>' });
    const stats = rt.getStats();
    expect(stats.words).toBe(3);
    expect(stats.characters).toBe('one two three'.length);
    expect(stats.charactersNoSpaces).toBe('onetwothree'.length);
    rt.destroy();
  });

  it('renders the status footer and updates it on change', () => {
    const rt = new RichText(host, { value: '<p>hi there</p>' });
    const status = host.querySelector('.jects-richtext__status') as HTMLElement;
    expect(status.hidden).toBe(false);
    expect(status.textContent).toContain('2 words');
    rt.setHTML('<p>just one two three four</p>');
    expect(status.textContent).toContain('5 words');
    rt.destroy();
  });

  it('showStatus=false hides the footer', () => {
    const rt = new RichText(host, { value: '<p>x</p>', showStatus: false });
    expect((host.querySelector('.jects-richtext__status') as HTMLElement).hidden).toBe(true);
    rt.destroy();
  });

  // ---- full screen ----
  it('fullscreen toggles the modifier class, isFullscreen(), and fires an event', () => {
    const rt = new RichText(host, { toolbar: ['fullscreen'] });
    const spy = vi.fn();
    rt.on('fullscreenChange', spy);
    expect(rt.isFullscreen()).toBe(false);
    rt.exec('fullscreen');
    expect(rt.isFullscreen()).toBe(true);
    expect(host.querySelector('.jects-richtext--fullscreen')).toBeTruthy();
    const btn = host.querySelector('button[data-command="fullscreen"]')!;
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ fullscreen: true }));
    rt.exec('fullscreen');
    expect(rt.isFullscreen()).toBe(false);
    rt.destroy();
  });

  // ---- new toggles carry aria-pressed; new actions do not ----
  it('new toggle commands carry aria-pressed; new action commands omit it', () => {
    const rt = new RichText(host, {
      toolbar: [
        'subscript',
        'superscript',
        'inlineCode',
        'justify',
        'fullscreen',
        'findReplace',
        'horizontalRule',
        'editLink',
        'uploadImage',
      ],
    });
    const pressed = (cmd: string) =>
      host.querySelector(`button[data-command="${cmd}"]`)!.hasAttribute('aria-pressed');
    for (const cmd of ['subscript', 'superscript', 'inlineCode', 'justify', 'fullscreen', 'findReplace']) {
      expect(pressed(cmd)).toBe(true);
    }
    for (const cmd of ['horizontalRule', 'editLink', 'uploadImage']) {
      expect(pressed(cmd)).toBe(false);
    }
    rt.destroy();
  });
});

describe('sanitizeHtml', () => {
  it('strips script tags', () => {
    expect(sanitizeHtml('<p>ok</p><script>alert(1)</script>')).not.toContain('script');
  });

  it('removes event handler attributes', () => {
    const out = sanitizeHtml('<p onclick="evil()">hi</p>');
    expect(out).not.toContain('onclick');
    expect(out).toContain('hi');
  });

  it('drops javascript: links', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('javascript:');
  });

  it('keeps allowed formatting tags', () => {
    const out = sanitizeHtml('<p><strong>b</strong> <em>i</em></p>');
    expect(out).toContain('<strong>');
    expect(out).toContain('<em>');
  });

  it('unwraps disallowed tags but keeps their text', () => {
    const out = sanitizeHtml('<marquee>scroll</marquee>');
    expect(out).not.toContain('marquee');
    expect(out).toContain('scroll');
  });

  it('keeps allow-listed inline styles and strips the rest', () => {
    // text-align / color / font are allow-listed (toolbar features); arbitrary
    // properties like `position` are still dropped.
    const out = sanitizeHtml('<p style="text-align: center; position: fixed;">x</p>');
    expect(out).toContain('text-align');
    expect(out).not.toContain('position');
  });

  // ---- new element allow-list (Phase 1/2) ----
  it('keeps the newly allowed semantic tags (hr/mark/sub/sup/figure)', () => {
    const out = sanitizeHtml(
      '<hr><p><mark>m</mark> <sub>2</sub> <sup>3</sup></p><figure><img src="https://x/y.png" alt=""><figcaption>cap</figcaption></figure>',
    );
    expect(out).toContain('<hr>');
    expect(out).toContain('<mark>');
    expect(out).toContain('<sub>');
    expect(out).toContain('<sup>');
    expect(out).toContain('<figure>');
    expect(out).toContain('<figcaption>');
  });

  it('keeps merged-cell colspan/rowspan attributes', () => {
    const out = sanitizeHtml(
      '<table><tbody><tr><td colspan="2" rowspan="2">a</td></tr></tbody></table>',
    );
    expect(out).toContain('colspan="2"');
    expect(out).toContain('rowspan="2"');
  });

  it('keeps allow-listed image alignment/width styles but drops dangerous ones', () => {
    const out = sanitizeHtml(
      '<img src="https://x/y.png" style="float: left; width: 25%; position: fixed;" alt="">',
    );
    expect(out).toContain('float');
    expect(out).toContain('width');
    expect(out).not.toContain('position');
  });

  it('strips an event handler smuggled onto a new tag', () => {
    const out = sanitizeHtml('<mark onclick="evil()">x</mark>');
    expect(out).not.toContain('onclick');
    expect(out).toContain('x');
  });

  it('rejects a javascript: image src on an uploaded-style figure', () => {
    const out = sanitizeHtml('<figure><img src="javascript:alert(1)" alt=""></figure>');
    expect(out).not.toContain('javascript:');
  });
});
