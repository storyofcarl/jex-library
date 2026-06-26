/**
 * `@jects/react/diagram` — isolated React binding for the Jects Diagram engine.
 *
 * Importing this entry pulls in ONLY `@jects/diagram` (plus the shared factory and
 * React), never any sibling engine.
 */
import { Diagram, type DiagramConfig, type DiagramEvents } from '@jects/diagram';
import { createComponent } from './factory.js';

export const JectsDiagram = createComponent<Diagram, DiagramConfig, DiagramEvents>(Diagram);
export type { DiagramConfig, DiagramEvents };
