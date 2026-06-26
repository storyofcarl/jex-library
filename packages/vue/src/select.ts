/**
 * `@jects/vue/select` — typed Vue 3 binding for the `@jects/widgets` {@link Select} only.
 *
 * Imports only the shared factory and the `@jects/widgets` engine.
 */
import { createComponent } from './factory.js';
import { Select, type SelectConfig, type SelectEvents } from '@jects/widgets';

export const JectsSelect = createComponent<Select, SelectConfig, SelectEvents>(Select);

export type { SelectConfig, SelectEvents };
