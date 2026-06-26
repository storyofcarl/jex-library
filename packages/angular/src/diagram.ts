/**
 * `@jects/angular/diagram` — typed Angular standalone binding for the {@link Diagram} engine.
 *
 * Importing this subpath pulls in `@jects/diagram` and the shared factory only, never a
 * sibling engine. Use the root `@jects/angular` entry for the whole suite.
 */
import { createComponent } from './factory.js';
import { Diagram, type DiagramConfig, type DiagramEvents } from '@jects/diagram';

export const JectsDiagram = createComponent<Diagram, DiagramConfig, DiagramEvents>(Diagram, {
  selector: 'jects-diagram',
});

export type { DiagramConfig, DiagramEvents };
