/**
 * `@jects/react/button` — isolated React binding for the Jects Button widget.
 *
 * Importing this entry pulls in ONLY the Button symbol from `@jects/widgets`
 * (plus the shared factory and React), never any data/scheduling engine.
 */
import { Button, type ButtonConfig, type ButtonEvents } from '@jects/widgets';
import { createComponent } from './factory.js';

export const JectsButton = createComponent<Button, ButtonConfig, ButtonEvents>(Button);
export type { ButtonConfig, ButtonEvents };
