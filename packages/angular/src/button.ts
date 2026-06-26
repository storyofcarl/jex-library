/**
 * `@jects/angular/button` — typed Angular standalone binding for the {@link Button} widget.
 *
 * Importing this subpath pulls in `@jects/widgets` and the shared factory only, never a
 * data/scheduling engine (grid, gantt, …). Use the root `@jects/angular` entry for the
 * whole suite.
 */
import { createComponent } from './factory.js';
import { Button, type ButtonConfig, type ButtonEvents } from '@jects/widgets';

export const JectsButton = createComponent<Button, ButtonConfig, ButtonEvents>(Button, {
  selector: 'jects-button',
});

export type { ButtonConfig, ButtonEvents };
