/** jsdom unit test for Window — render + interaction + emitted events. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Window } from './window.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

function dispatchPointer(
  target: EventTarget,
  type: string,
  init: Partial<PointerEventInit> = {},
): void {
  target.dispatchEvent(
    new MouseEvent(type, { bubbles: true, button: 0, ...init }) as unknown as PointerEvent,
  );
}

describe('Window (jsdom)', () => {
  it('renders a dialog panel with header, title, body', () => {
    const w = new Window(host, { title: 'Files', text: 'Body' });
    const el = host.querySelector('.jects-window') as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.querySelector('.jects-window__title')?.textContent).toBe('Files');
    expect(el.querySelector('.jects-window__body')?.textContent).toContain('Body');
    expect(el.getAttribute('aria-labelledby')).toBe(`${w.id}-title`);
    w.destroy();
  });

  it('applies initial geometry from config', () => {
    const w = new Window(host, { x: 100, y: 50, width: 500, height: 400 });
    const el = host.querySelector('.jects-window') as HTMLElement;
    expect(el.style.left).toBe('100px');
    expect(el.style.top).toBe('50px');
    expect(el.style.width).toBe('500px');
    expect(el.style.height).toBe('400px');
    w.destroy();
  });

  it('renders resize handles when resizable, none when not', () => {
    const a = new Window(host, { resizable: true });
    expect(host.querySelectorAll('.jects-window__resize').length).toBe(8);
    a.destroy();
    const b = new Window(host, { resizable: false });
    expect(host.querySelectorAll('.jects-window__resize').length).toBe(0);
    b.destroy();
  });

  it('close button emits beforeClose + close and destroys', () => {
    const w = new Window(host, { title: 'X' });
    const before = vi.fn();
    const close = vi.fn();
    w.on('beforeClose', before);
    w.on('close', close);
    const btn = host.querySelector('.jects-window__close') as HTMLButtonElement;
    btn.click();
    expect(before).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(close.mock.calls[0]![0].reason).toBe('close-button');
    expect(host.querySelector('.jects-window')).toBeNull();
  });

  it('beforeClose veto cancels close', () => {
    const w = new Window(host, { title: 'X' });
    w.on('beforeClose', () => false);
    const close = vi.fn();
    w.on('close', close);
    w.close();
    expect(close).not.toHaveBeenCalled();
    expect(host.querySelector('.jects-window')).toBeTruthy();
    w.destroy();
  });

  it('maximize/restore toggles state and emits events', () => {
    const w = new Window(host, { x: 10, y: 20, width: 300, height: 200 });
    const maxSpy = vi.fn();
    const restoreSpy = vi.fn();
    w.on('maximize', maxSpy);
    w.on('restore', restoreSpy);
    const el = host.querySelector('.jects-window') as HTMLElement;

    w.maximize();
    expect(w.maximized).toBe(true);
    expect(el.classList.contains('jects-window--maximized')).toBe(true);
    expect(maxSpy).toHaveBeenCalledTimes(1);

    w.restore();
    expect(w.maximized).toBe(false);
    expect(el.style.width).toBe('300px');
    expect(restoreSpy).toHaveBeenCalledTimes(1);
    w.destroy();
  });

  it('maximize button toggles via click', () => {
    const w = new Window(host, { title: 'X' });
    const btn = host.querySelector('.jects-window__maximize') as HTMLButtonElement;
    btn.click();
    expect(w.maximized).toBe(true);
    const btn2 = host.querySelector('.jects-window__maximize') as HTMLButtonElement;
    btn2.click();
    expect(w.maximized).toBe(false);
    w.destroy();
  });

  it('moveTo updates position and emits move', () => {
    const w = new Window(host);
    const spy = vi.fn();
    w.on('move', spy);
    w.moveTo(150, 175);
    const el = host.querySelector('.jects-window') as HTMLElement;
    expect(el.style.left).toBe('150px');
    expect(el.style.top).toBe('175px');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].x).toBe(150);
    w.destroy();
  });

  it('resizeTo clamps to minWidth/minHeight and emits resize', () => {
    const w = new Window(host, { minWidth: 250, minHeight: 150 });
    const spy = vi.fn();
    w.on('resize', spy);
    w.resizeTo(100, 100); // below the minimums
    expect(spy.mock.calls[0]![0].width).toBe(250);
    expect(spy.mock.calls[0]![0].height).toBe(150);
    w.destroy();
  });

  it('dragging the header moves the window and commits with a move event', () => {
    const w = new Window(host, { x: 0, y: 0 });
    const spy = vi.fn();
    w.on('move', spy);
    const header = host.querySelector('.jects-window__header') as HTMLElement;
    dispatchPointer(header, 'pointerdown', { clientX: 0, clientY: 0, pointerId: 1 });
    dispatchPointer(document, 'pointermove', { clientX: 30, clientY: 40, pointerId: 1 });
    dispatchPointer(document, 'pointerup', { clientX: 30, clientY: 40, pointerId: 1 });
    const el = host.querySelector('.jects-window') as HTMLElement;
    expect(el.style.left).toBe('30px');
    expect(el.style.top).toBe('40px');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(w.getConfig().x).toBe(30);
    w.destroy();
  });

  it('resizing from the SE handle grows the window and emits resize', () => {
    const w = new Window(host, { x: 0, y: 0, width: 300, height: 200 });
    const spy = vi.fn();
    w.on('resize', spy);
    const handle = host.querySelector('.jects-window__resize--se') as HTMLElement;
    dispatchPointer(handle, 'pointerdown', { clientX: 0, clientY: 0, pointerId: 2 });
    dispatchPointer(document, 'pointermove', { clientX: 50, clientY: 60, pointerId: 2 });
    dispatchPointer(document, 'pointerup', { clientX: 50, clientY: 60, pointerId: 2 });
    const el = host.querySelector('.jects-window') as HTMLElement;
    expect(el.style.width).toBe('350px');
    expect(el.style.height).toBe('260px');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].width).toBe(350);
    w.destroy();
  });

  it('beforeMove veto reverts the drag', () => {
    const w = new Window(host, { x: 5, y: 5 });
    w.on('beforeMove', () => false);
    const header = host.querySelector('.jects-window__header') as HTMLElement;
    dispatchPointer(header, 'pointerdown', { clientX: 0, clientY: 0, pointerId: 3 });
    dispatchPointer(document, 'pointermove', { clientX: 100, clientY: 100, pointerId: 3 });
    dispatchPointer(document, 'pointerup', { clientX: 100, clientY: 100, pointerId: 3 });
    const el = host.querySelector('.jects-window') as HTMLElement;
    expect(el.style.left).toBe('5px');
    expect(el.style.top).toBe('5px');
    w.destroy();
  });

  it('modal renders a Mask backdrop and sets aria-modal', () => {
    const w = new Window(host, { title: 'Modal', modal: true });
    const el = host.querySelector('.jects-window') as HTMLElement;
    expect(el.getAttribute('aria-modal')).toBe('true');
    expect(host.querySelector('.jects-mask')).toBeTruthy();
    w.destroy();
    // Backdrop is torn down with the window.
    expect(host.querySelector('.jects-mask')).toBeNull();
  });

  it('modal panel stacks ABOVE its own backdrop (regression: popup unclickable)', () => {
    // Regression for the calendar "popup error": toFront() writes an inline
    // z-index that overrides the CSS modal layer; if it starts below the Mask's
    // overlay z-index the backdrop covers the panel and eats every click on the
    // form. The panel's z-index must be strictly greater than its mask's.
    const w = new Window(host, { title: 'Modal', modal: true });
    const panel = host.querySelector('.jects-window') as HTMLElement;
    const mask = host.querySelector('.jects-mask') as HTMLElement;
    const zPanel = Number(panel.style.zIndex);
    const zMask = Number(mask.style.zIndex);
    expect(Number.isFinite(zPanel)).toBe(true);
    expect(Number.isFinite(zMask)).toBe(true);
    expect(zPanel).toBeGreaterThan(zMask);
    w.destroy();
  });

  it('Escape closes a modal closable window with reason escape', () => {
    const w = new Window(host, { title: 'Modal', modal: true });
    const spy = vi.fn();
    w.on('close', spy);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].reason).toBe('escape');
    expect(host.querySelector('.jects-window')).toBeNull();
  });

  it('non-modal window ignores Escape', () => {
    const w = new Window(host, { title: 'X', modal: false });
    const spy = vi.fn();
    w.on('close', spy);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(spy).not.toHaveBeenCalled();
    w.destroy();
  });

  it('toFront assigns an increasing z-index', () => {
    const a = new Window(host, { title: 'A' });
    const b = new Window(host, { title: 'B' });
    const za = Number(a.el.style.zIndex);
    const zb = Number(b.el.style.zIndex);
    expect(zb).toBeGreaterThan(za);
    a.toFront();
    expect(Number(a.el.style.zIndex)).toBeGreaterThan(zb);
    a.destroy();
    b.destroy();
  });

  it('minimize hides the window and emits minimize', () => {
    const w = new Window(host, { title: 'X' });
    const spy = vi.fn();
    w.on('minimize', spy);
    w.minimize();
    expect((host.querySelector('.jects-window') as HTMLElement).hidden).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    w.destroy();
  });

  it('committing a drag to the top-left edge (0,0) does not snap back', () => {
    // Regression: parseFloat(...)||orig treated a legitimate 0 as missing.
    const w = new Window(host, { x: 80, y: 90 });
    const header = host.querySelector('.jects-window__header') as HTMLElement;
    dispatchPointer(header, 'pointerdown', { clientX: 80, clientY: 90, pointerId: 9 });
    // Move so left/top land exactly at 0.
    dispatchPointer(document, 'pointermove', { clientX: 0, clientY: 0, pointerId: 9 });
    dispatchPointer(document, 'pointerup', { clientX: 0, clientY: 0, pointerId: 9 });
    const el = host.querySelector('.jects-window') as HTMLElement;
    expect(el.style.left).toBe('0px');
    expect(el.style.top).toBe('0px');
    expect(w.getConfig().x).toBe(0);
    expect(w.getConfig().y).toBe(0);
    w.destroy();
  });

  it('a window without title or label still has an accessible name', () => {
    const w = new Window(host, {});
    const el = host.querySelector('.jects-window') as HTMLElement;
    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.getAttribute('aria-label')).toBeTruthy();
    expect(el.hasAttribute('aria-labelledby')).toBe(false);
    w.destroy();
  });

  it('update({modal:true}) installs backdrop + aria-modal in lockstep', () => {
    const w = new Window(host, { title: 'Live', modal: false });
    expect(host.querySelector('.jects-mask')).toBeNull();
    const el = host.querySelector('.jects-window') as HTMLElement;
    expect(el.hasAttribute('aria-modal')).toBe(false);

    w.update({ modal: true });
    expect(el.getAttribute('aria-modal')).toBe('true');
    expect(el.classList.contains('jects-window--modal')).toBe(true);
    expect(host.querySelector('.jects-mask')).toBeTruthy();

    // Escape now closes (modal behaviour really installed).
    const spy = vi.fn();
    w.on('close', spy);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('update({modal:false}) tears down backdrop + listeners (no leak)', () => {
    const w = new Window(host, { title: 'Live', modal: true });
    expect(host.querySelector('.jects-mask')).toBeTruthy();

    w.update({ modal: false });
    const el = host.querySelector('.jects-window') as HTMLElement;
    expect(el.hasAttribute('aria-modal')).toBe(false);
    expect(el.classList.contains('jects-window--modal')).toBe(false);
    // Backdrop removed.
    expect(host.querySelector('.jects-mask')).toBeNull();
    // Escape no longer closes (listener removed).
    const spy = vi.fn();
    w.on('close', spy);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(spy).not.toHaveBeenCalled();
    w.destroy();
  });

  it('modal hides sibling background content from AT and restores it on teardown', () => {
    // jsdom does not implement the `inert` IDL property, so assert on the
    // aria-hidden mirror here; real-browser `inert` is covered by the a11y test.
    const sibling = document.createElement('div');
    sibling.innerHTML = '<button type="button">bg</button>';
    document.body.appendChild(sibling);
    try {
      const w = new Window(host, { title: 'Modal', modal: true });
      expect(sibling.getAttribute('aria-hidden')).toBe('true');
      w.destroy();
      expect(sibling.hasAttribute('aria-hidden')).toBe(false);
    } finally {
      sibling.remove();
    }
  });

  it('destroy removes the element and is idempotent', () => {
    const w = new Window(host, { title: 'X' });
    w.destroy();
    expect(host.querySelector('.jects-window')).toBeNull();
    expect(() => w.destroy()).not.toThrow();
  });
});
