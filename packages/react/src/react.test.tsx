import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { Button } from '@jects/widgets';
import type { Grid } from '@jects/grid';

import {
  JectsButton,
  JectsGrid,
  JectsGantt,
  JectsForm,
  JectsChart,
} from './index.js';

afterEach(cleanup);

describe('@jects/react smoke suite', () => {
  it('renders the engine DOM inside the host for representative wrappers', () => {
    const { container, unmount } = render(
      <>
        <JectsButton text="Click me" />
        <JectsGrid data={[{ id: 1, name: 'Ada' }]} columns={[{ field: 'name', header: 'Name' }]} />
        <JectsGantt tasks={[{ id: 1, name: 'Task 1' }]} />
        <JectsForm fields={[{ name: 'email', control: 'text', label: 'Email' }]} />
        <JectsChart type="line" data={[1, 2, 3]} />
      </>,
    );

    // Each engine paints its own `.jects-*` root element into the React host <div>.
    expect(container.querySelector('.jects-btn')).not.toBeNull();
    expect(container.querySelector('.jects-grid')).not.toBeNull();
    expect(container.querySelector('.jects-gantt')).not.toBeNull();
    expect(container.querySelector('.jects-form')).not.toBeNull();
    expect(container.querySelector('.jects-chart')).not.toBeNull();

    unmount();
  });

  it('bridges an `on<Event>` prop to the engine event (Button click)', () => {
    const onClick = vi.fn();
    const { container } = render(<JectsButton text="Go" onClick={onClick} />);

    const btn = container.querySelector('.jects-btn');
    expect(btn).not.toBeNull();

    fireEvent.click(btn as HTMLElement);
    expect(onClick).toHaveBeenCalledTimes(1);
    // The bridged payload carries the engine event shape, not a raw DOM event.
    expect(onClick.mock.calls[0]![0]).toMatchObject({ button: expect.anything() });
  });

  it('keeps the latest handler current without remounting', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { container, rerender } = render(<JectsButton text="Go" onClick={first} />);

    const btnBefore = container.querySelector('.jects-btn');
    rerender(<JectsButton text="Go" onClick={second} />);
    const btnAfter = container.querySelector('.jects-btn');

    // Same DOM node => handler swap did not force a remount.
    expect(btnAfter).toBe(btnBefore);

    fireEvent.click(btnAfter as HTMLElement);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('applies a config prop change via update() WITHOUT remounting', () => {
    const ref = createRef<Grid>();
    const { container, rerender } = render(
      <JectsGrid
        ref={ref}
        data={[{ id: 1, name: 'Ada' }]}
        columns={[{ field: 'name', header: 'Name' }]}
      />,
    );

    const rootBefore = container.querySelector('.jects-grid');
    expect(rootBefore).not.toBeNull();
    const instanceBefore = ref.current;
    expect(instanceBefore).not.toBeNull();
    const updateSpy = vi.spyOn(instanceBefore as Grid, 'update');

    rerender(
      <JectsGrid
        ref={ref}
        data={[
          { id: 1, name: 'Ada' },
          { id: 2, name: 'Grace' },
        ]}
        columns={[{ field: 'name', header: 'Name' }]}
      />,
    );

    const rootAfter = container.querySelector('.jects-grid');
    // Same root element + same engine instance => in-place update, not a remount.
    expect(rootAfter).toBe(rootBefore);
    expect(ref.current).toBe(instanceBefore);
    expect(updateSpy).toHaveBeenCalled();

    // The new data is reflected in the live config.
    const data = (ref.current!.getConfig() as { data: unknown[] }).data;
    expect(data).toHaveLength(2);
  });

  it('destroys the engine and cleans up the DOM on unmount', () => {
    const ref = createRef<Button>();
    const { container, unmount } = render(<JectsButton ref={ref} text="Bye" />);

    const inst = ref.current;
    expect(inst).not.toBeNull();
    expect(container.querySelector('.jects-btn')).not.toBeNull();
    expect(inst!.isDestroyed).toBe(false);

    unmount();

    expect(inst!.isDestroyed).toBe(true);
    expect(container.querySelector('.jects-btn')).toBeNull();
  });
});
