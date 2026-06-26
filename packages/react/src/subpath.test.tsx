import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// Import each wrapper from its OWN per-component entry (the source counterpart of the
// `@jects/react/<name>` subpath) rather than the root barrel. This proves every
// subpath entry resolves, renders its engine, and carries the right export — the
// same contract the built `dist/<name>.js` chunks expose to isolated installs.
import { JectsGrid } from './grid.js';
import { JectsButton } from './button.js';
import { JectsChart } from './charts.js';

afterEach(cleanup);

describe('@jects/react per-component subpath entries', () => {
  it('renders a grid imported from the grid-only entry', () => {
    const { container, unmount } = render(
      <JectsGrid data={[{ id: 1, name: 'Ada' }]} columns={[{ field: 'name', header: 'Name' }]} />,
    );
    expect(container.querySelector('.jects-grid')).not.toBeNull();
    unmount();
  });

  it('renders a button imported from the button-only entry', () => {
    const { container, unmount } = render(<JectsButton text="Hi" />);
    expect(container.querySelector('.jects-btn')).not.toBeNull();
    unmount();
  });

  it('renders a chart imported from the charts-only entry', () => {
    const { container, unmount } = render(<JectsChart type="line" data={[1, 2, 3]} />);
    expect(container.querySelector('.jects-chart')).not.toBeNull();
    unmount();
  });
});
