/** Route: rich text. */
import { el, card } from '../shell/dom.js';
import { section, RichText } from '../shell/registry.js';

export function register() {
  section('richtext', 'Rich Text', 'WYSIWYG editor with a configurable toolbar.', (grid) => {
    grid.appendChild(card('RichText — images · tables · color · fonts · source view · markdown', (h) => {
      const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:.5rem;width:100%' });
      const editorHost = el('div'); wrap.appendChild(editorHost);
      const bar = el('div', { class: 'g-host-toolbar', style: 'display:flex;gap:.4rem;align-items:center' });
      wrap.appendChild(bar); h.appendChild(wrap);
      const rt = new RichText(editorHost, {
        toolbar: [
          'bold', 'italic', 'underline', 'strike', 'separator',
          'h1', 'h2', 'paragraph', 'separator',
          'fontFamily', 'fontSize', 'foreColor', 'backColor', 'separator',
          'ul', 'ol', 'indent', 'outdent', 'blockquote', 'code', 'separator',
          'link', 'insertImage', 'insertTable', 'separator',
          'alignLeft', 'alignCenter', 'alignRight', 'separator',
          'sourceView', 'undo', 'redo', 'clear',
        ],
        pasteClean: true,
        value: '<h2>Quarterly report</h2>'
          + '<p>Edit this <strong>rich</strong> <em>content</em> — try the <span style="color:#0ea5e9">color</span>, font, image and table tools.</p>'
          + '<table><thead><tr><th>Region</th><th>Revenue</th></tr></thead>'
          + '<tbody><tr><td>West</td><td>$24,600</td></tr><tr><td>East</td><td>$18,200</td></tr></tbody></table>'
          + '<ul><li>Bullet one</li><li>Bullet two</li></ul>',
      });
      const mdBtn = el('button', { class: 'jects-btn jects-btn--sm', text: 'Export Markdown' });
      const mdOut = el('pre', { style: 'display:none;max-height:120px;overflow:auto;background:oklch(var(--jects-muted));padding:.5rem;border-radius:var(--jects-radius-sm);font-size:11px;white-space:pre-wrap' });
      mdBtn.addEventListener('click', () => {
        try { mdOut.textContent = rt.getMarkdown(); mdOut.style.display = 'block'; }
        catch (e) { console.warn('RT-DEMO feature failed:', e && e.message); }
      });
      bar.appendChild(mdBtn); wrap.appendChild(mdOut);
    }, { block: true }));
  }, { wide: true });
}
