/**
 * `@jects/react/window` — isolated React binding for the Jects Window widget.
 *
 * Importing this entry pulls in ONLY the Window symbol from `@jects/widgets`
 * (plus the shared factory and React), never any data/scheduling engine.
 */
import { Window, type WindowConfig, type WindowEvents } from '@jects/widgets';
import { createComponent } from './factory.js';

export const JectsWindow = createComponent<Window, WindowConfig, WindowEvents>(Window);
export type { WindowConfig, WindowEvents };
