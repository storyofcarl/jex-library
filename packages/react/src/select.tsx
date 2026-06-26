/**
 * `@jects/react/select` — isolated React binding for the Jects Select widget.
 *
 * Importing this entry pulls in ONLY the Select symbol from `@jects/widgets`
 * (plus the shared factory and React), never any data/scheduling engine.
 */
import { Select, type SelectConfig, type SelectEvents } from '@jects/widgets';
import { createComponent } from './factory.js';

export const JectsSelect = createComponent<Select, SelectConfig, SelectEvents>(Select);
export type { SelectConfig, SelectEvents };
