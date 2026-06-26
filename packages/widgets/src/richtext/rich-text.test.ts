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
});
