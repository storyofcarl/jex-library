/**
 * `@jects/elements/diagram` — the `<jects-diagram>` custom element only.
 * Importing this entry pulls ONLY `@jects/diagram` plus the engine-free shared factory.
 */
import { Diagram, type DiagramConfig, type DiagramEvents } from '@jects/diagram';
import { createComponent, defineElements, type JectsElementDefinition } from './shared.js';

export const JectsDiagramElement = createComponent<Diagram, DiagramConfig, DiagramEvents>(Diagram);

/** The `<jects-diagram>` tag paired with its element class. */
export const diagramElementDefinition: JectsElementDefinition = {
  tag: 'jects-diagram',
  ctor: JectsDiagramElement,
};

/** Define `<jects-diagram>` into a registry (defaults to the global `customElements`). Idempotent. */
export function registerDiagram(target?: CustomElementRegistry): void {
  defineElements([diagramElementDefinition], target);
}

export {
  createComponent,
  type JectsElement,
  type JectsElementConstructor,
  type JectsElementDefinition,
} from './shared.js';
export type { DiagramConfig, DiagramEvents };
