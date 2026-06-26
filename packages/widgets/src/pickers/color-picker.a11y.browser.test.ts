/**
 * axe-core accessibility test (real Chromium, Vitest browser mode).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 *
 * Asserts the ColorPicker has zero serious/critical a11y violations both with
 * the popover closed and open (the open state is where roles, focus, and the
 * SV slider value matter most).
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { ColorPicker } from './color-picker.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('ColorPicker (axe-core)', () => {
  it('has no serious/critical violations when closed', async () => {
    const p = new ColorPicker(host, { value: '#ff0000' });
    await expectNoA11yViolations(host);
    p.destroy();
  });

  it('has no serious/critical violations when open', async () => {
    const p = new ColorPicker(host, { value: '#3366cc' });
    p.openPopover();
    // The popover is portaled to document.body while open (escapes overflow).
    await expectNoA11yViolations(document.body);
    p.close();
    p.destroy();
  });

  it('has no serious/critical violations when disabled', async () => {
    const p = new ColorPicker(host, { value: '#000000', disabled: true });
    await expectNoA11yViolations(host);
    p.destroy();
  });

  it('moves focus into the dialog on open and restores it on close', async () => {
    const p = new ColorPicker(host, { value: '#00ff00' });
    const trigger = host.querySelector('.jects-colorpicker__trigger') as HTMLButtonElement;
    trigger.focus();
    p.openPopover();
    // The popover is portaled to document.body while open.
    const popover = document.querySelector('.jects-colorpicker__popover') as HTMLElement;
    // Focus must have moved into the popover (focus trap precondition).
    if (!popover.contains(document.activeElement)) {
      throw new Error('focus did not move into the dialog on open');
    }
    p.close();
    if (document.activeElement !== trigger) {
      throw new Error('focus was not restored to the trigger on close');
    }
    p.destroy();
  });

  it('publishes a determinate value on the SV slider', async () => {
    const p = new ColorPicker(host, { value: '#ff0000' });
    const sv = host.querySelector('.jects-colorpicker__sv') as HTMLElement;
    if (sv.getAttribute('aria-valuenow') == null) {
      throw new Error('SV slider is missing aria-valuenow');
    }
    if (sv.getAttribute('aria-valuemin') !== '0' || sv.getAttribute('aria-valuemax') !== '100') {
      throw new Error('SV slider is missing aria-valuemin/aria-valuemax');
    }
    p.destroy();
  });
});
