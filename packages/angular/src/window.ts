/**
 * `@jects/angular/window` — typed Angular standalone binding for the {@link Window} widget.
 *
 * Importing this subpath pulls in `@jects/widgets` and the shared factory only, never a
 * data/scheduling engine (grid, gantt, …). Use the root `@jects/angular` entry for the
 * whole suite.
 */
import { createComponent } from './factory.js';
import { Window, type WindowConfig, type WindowEvents } from '@jects/widgets';

export const JectsWindow = createComponent<Window, WindowConfig, WindowEvents>(Window, {
  selector: 'jects-window',
});

export type { WindowConfig, WindowEvents };
