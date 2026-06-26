/**
 * `@jects/vue/diagram` — typed Vue 3 binding for {@link Diagram} only.
 *
 * Imports only the shared factory and the `@jects/diagram` engine.
 */
import { createComponent } from './factory.js';
import { Diagram, type DiagramConfig, type DiagramEvents } from '@jects/diagram';

export const JectsDiagram = createComponent<Diagram, DiagramConfig, DiagramEvents>(Diagram);

export type { DiagramConfig, DiagramEvents };
