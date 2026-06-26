import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import type { Grid } from '@jects/grid';

import {
  JectsButton,
  JectsGrid,
  JectsGantt,
  JectsForm,
  JectsChart,
} from './index.js';

enableAutoUnmount(afterEach);

describe('@jects/vue smoke suite', () => {
  it('renders the engine DOM inside the host for representative wrappers', () => {
    const button = mount(JectsButton, { props: { text: 'Click me' } });
    const grid = mount(JectsGrid, {
      props: { data: [{ id: 1, name: 'Ada' }], columns: [{ field: 'name', header: 'Name' }] },
    });
    const gantt = mount(JectsGantt, { props: { tasks: [{ id: 1, name: 'Task 1' }] } });
    const form = mount(JectsForm, {
      props: { fields: [{ name: 'email', control: 'text', label: 'Email' }] },
    });
    const chart = mount(JectsChart, { props: { type: 'line', data: [1, 2, 3] } });

    // Each engine paints its own `.jects-*` root element into the Vue host <div>.
    expect(button.find('.jects-btn').exists()).toBe(true);
    expect(grid.find('.jects-grid').exists()).toBe(true);
    expect(gantt.find('.jects-gantt').exists()).toBe(true);
    expect(form.find('.jects-form').exists()).toBe(true);
    expect(chart.find('.jects-chart').exists()).toBe(true);
  });

  it('bridges an `on<Event>` prop to the engine event (Button click)', async () => {
    const onClick = vi.fn();
    const wrapper = mount(JectsButton, { props: { text: 'Go', onClick } });

    const btn = wrapper.find('.jects-btn');
    expect(btn.exists()).toBe(true);

    await btn.trigger('click');
    expect(onClick).toHaveBeenCalledTimes(1);
    // The bridged payload carries the engine event shape, not a raw DOM event.
    expect(onClick.mock.calls[0]![0]).toMatchObject({ button: expect.anything() });
  });

  it('keeps the latest handler current without remounting', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const wrapper = mount(JectsButton, { props: { text: 'Go', onClick: first } });

    const elBefore = wrapper.find('.jects-btn').element;
    await wrapper.setProps({ onClick: second });
    const elAfter = wrapper.find('.jects-btn').element;

    // Same DOM node => handler swap did not force a remount.
    expect(elAfter).toBe(elBefore);

    await wrapper.find('.jects-btn').trigger('click');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('applies a config prop change via update() WITHOUT remounting', async () => {
    const wrapper = mount(JectsGrid, {
      props: { data: [{ id: 1, name: 'Ada' }], columns: [{ field: 'name', header: 'Name' }] },
    });

    const elBefore = wrapper.find('.jects-grid').element;
    expect(elBefore).toBeTruthy();

    const instanceBefore = (wrapper.vm as unknown as { instance: Grid }).instance;
    expect(instanceBefore).toBeTruthy();
    const updateSpy = vi.spyOn(instanceBefore, 'update');

    await wrapper.setProps({
      data: [
        { id: 1, name: 'Ada' },
        { id: 2, name: 'Grace' },
      ],
    });

    const elAfter = wrapper.find('.jects-grid').element;
    const instanceAfter = (wrapper.vm as unknown as { instance: Grid }).instance;

    // Same root element + same engine instance => in-place update, not a remount.
    expect(elAfter).toBe(elBefore);
    expect(instanceAfter).toBe(instanceBefore);
    expect(updateSpy).toHaveBeenCalled();

    // The new data is reflected in the live config.
    const data = (instanceAfter.getConfig() as { data: unknown[] }).data;
    expect(data).toHaveLength(2);
  });

  it('destroys the engine and cleans up the DOM on unmount', () => {
    const wrapper = mount(JectsButton, { props: { text: 'Bye' } });

    const inst = (wrapper.vm as unknown as { instance: { isDestroyed: boolean } }).instance;
    expect(inst).toBeTruthy();
    expect(wrapper.find('.jects-btn').exists()).toBe(true);
    expect(inst.isDestroyed).toBe(false);

    wrapper.unmount();

    expect(inst.isDestroyed).toBe(true);
  });
});
