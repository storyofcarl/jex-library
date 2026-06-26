/** Route: forms. */
import { el, card } from '../shell/dom.js';
import { section, Form } from '../shell/registry.js';

export function register() {
  section('forms', 'Forms', 'Declarative schema-driven forms with validation rules, fieldsets and grid layout.', (grid) => {
    grid.appendChild(card('Form — conditional fields · 20+ controls · dirty tracking · async validation', (h) => {
      const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:.5rem;width:100%' });
      const status = el('div', { class: 'g-note', text: 'Pristine — change a field to see dirty tracking.' });
      const host = el('div'); wrap.appendChild(host); wrap.appendChild(status); h.appendChild(wrap);
      const form = new Form(host, {
        ariaLabel: 'Enterprise contact form',
        layout: { cols: 2, fieldsets: [
          { legend: 'Contact', group: 'contact' },
          { legend: 'Preferences', group: 'prefs' },
        ] },
        validateOn: 'blur',
        fields: [
          { name: 'name', control: 'text', label: 'Name', group: 'contact', rules: { required: true } },
          { name: 'email', control: 'email', label: 'Email', group: 'contact', rules: { required: true, email: true } },
          { name: 'password', control: 'password', label: 'Password', group: 'contact', rules: { required: true, minLength: 8 } },
          { name: 'website', control: 'url', label: 'Website', group: 'contact' },
          { name: 'byPhone', control: 'switch', label: 'Prefer phone contact', group: 'prefs' },
          { name: 'phone', control: 'text', label: 'Phone', group: 'prefs',
            showWhen: (v) => !!v.byPhone, rules: { required: true, pattern: '^[0-9 +()-]{7,}$' } },
          { name: 'satisfaction', control: 'rating', label: 'Satisfaction', group: 'prefs', props: { max: 5 } },
          { name: 'budget', control: 'slider', label: 'Budget', group: 'prefs', props: { min: 0, max: 100, value: 40 } },
          { name: 'when', control: 'datetime', label: 'Best time', group: 'prefs' },
          { name: 'topics', control: 'checkboxgroup', label: 'Topics', group: 'prefs', props: { options: [
            { value: 'sales', label: 'Sales' }, { value: 'support', label: 'Support' }, { value: 'press', label: 'Press' },
          ] } },
          { name: 'tags', control: 'tags', label: 'Tags', group: 'prefs' },
          { name: 'role', control: 'select', label: 'Role', group: 'prefs', props: { options: [
            { value: 'eng', label: 'Engineer' }, { value: 'design', label: 'Designer' }, { value: 'pm', label: 'Product' },
          ] } },
        ],
        submitText: 'Send', resetText: 'Clear',
      });
      const refresh = () => {
        try {
          status.textContent = form.isDirty()
            ? `Dirty — changed: ${Object.keys(form.getDirtyValues()).join(', ') || '—'}`
            : 'Pristine — change a field to see dirty tracking.';
        } catch (e) { console.warn('FORM-DEMO feature failed:', e && e.message); }
      };
      try { form.on('change', refresh); form.on('dirty', refresh); } catch (e) { console.warn('FORM-DEMO feature failed:', e && e.message); }
    }, { block: true }));
    grid.appendChild(card('Two-column grid', (h) => {
      new Form(h, {
        ariaLabel: 'Profile form',
        layout: { cols: 2 },
        fields: [
          { name: 'first', control: 'text', label: 'First name', rules: { required: true } },
          { name: 'last', control: 'text', label: 'Last name', rules: { required: true } },
          { name: 'bio', control: 'textarea', label: 'Bio', colSpan: 2 },
          { name: 'age', control: 'number', label: 'Age', rules: { numeric: true, min: 18, max: 120 } },
          { name: 'role', control: 'select', label: 'Role', props: { options: [
            { value: 'eng', label: 'Engineer' }, { value: 'design', label: 'Designer' }, { value: 'pm', label: 'Product' },
          ] } },
        ],
      });
    }, { block: true }));
  }, { wide: true });
}
