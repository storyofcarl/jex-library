import { describe, expect, it, vi } from 'vitest';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { Button } from '@jects/widgets';

import { JectsButton, JectsGrid, JectsGantt, JectsForm, JectsChart } from './index.js';

function mount<T>(type: new (...args: never[]) => T, config: Record<string, unknown>) {
  const fixture = TestBed.createComponent(type) as unknown as ComponentFixture<unknown>;
  fixture.componentRef.setInput('config', config);
  fixture.detectChanges(); // triggers ngOnInit -> engine construction
  return fixture;
}

describe('@jects/angular smoke suite', () => {
  it('renders the engine DOM inside the host for representative wrappers', () => {
    const cases: Array<[new (...args: never[]) => unknown, Record<string, unknown>, string]> = [
      [JectsButton, { text: 'Click me' }, '.jects-btn'],
      [
        JectsGrid,
        { data: [{ id: 1, name: 'Ada' }], columns: [{ field: 'name', header: 'Name' }] },
        '.jects-grid',
      ],
      [JectsGantt, { tasks: [{ id: 1, name: 'Task 1' }] }, '.jects-gantt'],
      [JectsForm, { fields: [{ name: 'email', control: 'text', label: 'Email' }] }, '.jects-form'],
      [JectsChart, { type: 'line', data: [1, 2, 3] }, '.jects-chart'],
    ];

    for (const [type, config, sel] of cases) {
      const fixture = mount(type, config);
      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector(sel), sel).not.toBeNull();
      fixture.destroy();
    }
  });

  it('forwards a named engine event to (jectsEvent) (Button click)', () => {
    const fixture = TestBed.createComponent(JectsButton);
    fixture.componentRef.setInput('config', { text: 'Go' });
    fixture.componentRef.setInput('events', ['click']);

    const received: Array<{ type: string; payload: unknown }> = [];
    fixture.componentInstance.jectsEvent.subscribe((e) => received.push(e as never));
    fixture.detectChanges();

    const btn = (fixture.nativeElement as HTMLElement).querySelector('.jects-btn');
    expect(btn).not.toBeNull();
    (btn as HTMLElement).click();

    expect(received).toHaveLength(1);
    expect(received[0]!.type).toBe('click');
    fixture.destroy();
  });

  it('applies a config change via update() WITHOUT recreating the instance', () => {
    const fixture = mount(JectsGrid, {
      data: [{ id: 1, name: 'Ada' }],
      columns: [{ field: 'name', header: 'Name' }],
    });
    const instBefore = fixture.componentInstance.instance;
    expect(instBefore).not.toBeNull();
    const updateSpy = vi.spyOn(instBefore as unknown as { update: (p: unknown) => unknown }, 'update');

    fixture.componentRef.setInput('config', {
      data: [
        { id: 1, name: 'Ada' },
        { id: 2, name: 'Grace' },
      ],
      columns: [{ field: 'name', header: 'Name' }],
    });
    fixture.detectChanges();

    // Same instance => in-place update, not a recreate.
    expect(fixture.componentInstance.instance).toBe(instBefore);
    expect(updateSpy).toHaveBeenCalled();
    const data = (
      (instBefore as unknown as { getConfig: () => { data: unknown[] } }).getConfig()
    ).data;
    expect(data).toHaveLength(2);
    fixture.destroy();
  });

  it('destroys the engine and cleans up the DOM on destroy', () => {
    const fixture = mount(JectsButton, { text: 'Bye' });
    const inst = fixture.componentInstance.instance as Button;
    const host = fixture.nativeElement as HTMLElement;
    expect(inst).not.toBeNull();
    expect(host.querySelector('.jects-btn')).not.toBeNull();
    expect(inst.isDestroyed).toBe(false);

    fixture.destroy();

    expect(inst.isDestroyed).toBe(true);
    expect(fixture.componentInstance.instance).toBeNull();
  });
});
