/** jsdom unit test — runs in the default `pnpm test`. Covers render + interaction + event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FilePicker, formatBytes } from './file-picker.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

function makeFile(name: string, size: number, type = 'text/plain'): File {
  const f = new File(['x'], name, { type });
  // jsdom File.size derives from content; force the size we want for tests.
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

function fileList(...files: File[]): FileList {
  const list: Record<PropertyKey, unknown> = { ...files };
  list.length = files.length;
  list.item = (i: number) => files[i] ?? null;
  list[Symbol.iterator] = function* () {
    yield* files;
  };
  return list as unknown as FileList;
}

/** Simulate a native file selection. */
function selectFiles(picker: FilePicker, host: HTMLElement, ...files: File[]): void {
  const input = host.querySelector('.jects-filepicker__input') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: fileList(...files), configurable: true });
  input.dispatchEvent(new Event('change'));
}

describe('FilePicker (jsdom)', () => {
  it('renders a drop zone and hidden input', () => {
    const p = new FilePicker(host);
    expect(host.querySelector('.jects-filepicker')).toBeTruthy();
    const zone = host.querySelector('.jects-filepicker__zone') as HTMLElement;
    expect(zone.getAttribute('role')).toBe('button');
    expect(host.querySelector('.jects-filepicker__input')).toBeTruthy();
    expect(host.querySelector('.jects-filepicker__list')).toBeTruthy();
    p.destroy();
  });

  it('reflects accept/multiple on the input', () => {
    const p = new FilePicker(host, { accept: 'image/*', multiple: false });
    const input = host.querySelector('.jects-filepicker__input') as HTMLInputElement;
    expect(input.getAttribute('accept')).toBe('image/*');
    expect(input.multiple).toBe(false);
    p.destroy();
  });

  it('adds selected files and emits add + change', () => {
    const p = new FilePicker(host);
    const addSpy = vi.fn();
    const changeSpy = vi.fn();
    p.on('add', addSpy);
    p.on('change', changeSpy);
    selectFiles(p, host, makeFile('a.txt', 10), makeFile('b.txt', 20));
    expect(addSpy).toHaveBeenCalledTimes(2);
    expect(changeSpy).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll('.jects-filepicker__item').length).toBe(2);
    expect(p.getFiles().length).toBe(2);
    p.destroy();
  });

  it('shows name and size in each row', () => {
    const p = new FilePicker(host);
    selectFiles(p, host, makeFile('photo.png', 2048, 'image/png'));
    const row = host.querySelector('.jects-filepicker__item')!;
    expect(row.querySelector('.jects-filepicker__item-name')!.textContent).toBe('photo.png');
    expect(row.querySelector('.jects-filepicker__item-size')!.textContent).toBe('2 KB');
    p.destroy();
  });

  it('remove button removes the entry and emits remove + change', () => {
    const p = new FilePicker(host);
    selectFiles(p, host, makeFile('a.txt', 10));
    const removeSpy = vi.fn();
    const changeSpy = vi.fn();
    p.on('remove', removeSpy);
    p.on('change', changeSpy);
    const btn = host.querySelector('.jects-filepicker__remove') as HTMLButtonElement;
    btn.click();
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(changeSpy).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll('.jects-filepicker__item').length).toBe(0);
    p.destroy();
  });

  it('enforces maxSize and emits error', () => {
    const p = new FilePicker(host, { maxSize: 100 });
    const errorSpy = vi.fn();
    const addSpy = vi.fn();
    p.on('error', errorSpy);
    p.on('add', addSpy);
    selectFiles(p, host, makeFile('big.bin', 500));
    expect(addSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]![0].reason).toBe('maxSize');
    p.destroy();
  });

  it('enforces accept filter and emits error', () => {
    const p = new FilePicker(host, { accept: '.pdf' });
    const errorSpy = vi.fn();
    p.on('error', errorSpy);
    selectFiles(p, host, makeFile('note.txt', 10, 'text/plain'));
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]![0].reason).toBe('accept');
    p.destroy();
  });

  it('multiple:false keeps only the latest file', () => {
    const p = new FilePicker(host, { multiple: false });
    selectFiles(p, host, makeFile('a.txt', 10));
    selectFiles(p, host, makeFile('b.txt', 10));
    expect(p.getFiles().length).toBe(1);
    expect(p.getFiles()[0]!.name).toBe('b.txt');
    p.destroy();
  });

  it('beforeAdd veto rejects a file', () => {
    const p = new FilePicker(host);
    p.on('beforeAdd', () => false);
    selectFiles(p, host, makeFile('a.txt', 10));
    expect(p.getFiles().length).toBe(0);
    p.destroy();
  });

  it('setProgress updates the bar and emits progress', () => {
    const p = new FilePicker(host);
    selectFiles(p, host, makeFile('a.txt', 10));
    const id = p.getFiles()[0]!.id;
    const spy = vi.fn();
    p.on('progress', spy);
    p.setProgress(id, 50);
    expect(spy).toHaveBeenCalledTimes(1);
    const bar = host.querySelector('.jects-filepicker__progress-bar') as HTMLElement;
    expect(bar.style.width).toBe('50%');
    const wrap = host.querySelector('.jects-filepicker__progress')!;
    expect(wrap.getAttribute('aria-valuenow')).toBe('50');
    p.destroy();
  });

  it('drop ingests files from the dataTransfer', () => {
    const p = new FilePicker(host);
    const addSpy = vi.fn();
    p.on('add', addSpy);
    const zone = host.querySelector('.jects-filepicker__zone') as HTMLElement;
    const ev = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(ev, 'dataTransfer', { value: { files: fileList(makeFile('d.txt', 5)) } });
    zone.dispatchEvent(ev);
    expect(addSpy).toHaveBeenCalledTimes(1);
    p.destroy();
  });

  it('Enter key on the zone opens the dialog', () => {
    const p = new FilePicker(host);
    const input = host.querySelector('.jects-filepicker__input') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => {});
    const zone = host.querySelector('.jects-filepicker__zone') as HTMLElement;
    zone.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(clickSpy).toHaveBeenCalled();
    p.destroy();
  });

  it('disabled prevents opening the dialog', () => {
    const p = new FilePicker(host, { disabled: true });
    const input = host.querySelector('.jects-filepicker__input') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => {});
    (host.querySelector('.jects-filepicker__zone') as HTMLElement).click();
    expect(clickSpy).not.toHaveBeenCalled();
    p.destroy();
  });

  it('destroy removes the element', () => {
    const p = new FilePicker(host);
    p.destroy();
    expect(host.querySelector('.jects-filepicker')).toBeNull();
  });
});

describe('formatBytes', () => {
  it('formats common sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1048576)).toBe('1 MB');
  });
});
