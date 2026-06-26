/**
 * `@jects/vue/window` — typed Vue 3 binding for the `@jects/widgets` {@link Window} only.
 *
 * Imports only the shared factory and the `@jects/widgets` engine.
 */
import { createComponent } from './factory.js';
import { Window, type WindowConfig, type WindowEvents } from '@jects/widgets';

export const JectsWindow = createComponent<Window, WindowConfig, WindowEvents>(Window);

export type { WindowConfig, WindowEvents };
