/**
 * `@jects/vue/button` — typed Vue 3 binding for the `@jects/widgets` {@link Button} only.
 *
 * Imports only the shared factory and the `@jects/widgets` engine, never the data
 * engines (`@jects/grid`, `@jects/gantt`, …).
 */
import { createComponent } from './factory.js';
import { Button, type ButtonConfig, type ButtonEvents } from '@jects/widgets';

export const JectsButton = createComponent<Button, ButtonConfig, ButtonEvents>(Button);

export type { ButtonConfig, ButtonEvents };
