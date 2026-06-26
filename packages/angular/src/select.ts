/**
 * `@jects/angular/select` — typed Angular standalone binding for the {@link Select} widget.
 *
 * Importing this subpath pulls in `@jects/widgets` and the shared factory only, never a
 * data/scheduling engine (grid, gantt, …). Use the root `@jects/angular` entry for the
 * whole suite.
 */
import { createComponent } from './factory.js';
import { Select, type SelectConfig, type SelectEvents } from '@jects/widgets';

export const JectsSelect = createComponent<Select, SelectConfig, SelectEvents>(Select, {
  selector: 'jects-select',
});

export type { SelectConfig, SelectEvents };
