/**
 * Engine-free shared surface for `@jects/elements`.
 *
 * This module deliberately imports NOTHING from any `@jects/<engine>` package, so a
 * consumer that only needs the factory, the registration helper, or the shared types
 * can pull it (and any single per-component entry) WITHOUT a bundler resolving every
 * sibling engine. Per-component entry files import this module plus their own engine.
 */
import type { JectsElementConstructor } from './factory.js';

export { createComponent } from './factory.js';
export type {
  WidgetCtor,
  JectsElement,
  JectsElementConstructor,
  CreateComponentOptions,
} from './factory.js';

/** The custom-element tag for a generated element, paired with its class. */
export interface JectsElementDefinition {
  readonly tag: string;
  readonly ctor: JectsElementConstructor<object, unknown, unknown>;
}

/**
 * Define a list of `<jects-*>` custom elements. Idempotent: a tag already present in
 * the target registry is skipped, so calling this more than once is safe. Each
 * per-component entry exports its own one-element list plus a `register*` helper that
 * delegates here; the root index aggregates every list into a single {@link register}.
 *
 * @param defs   The tag/ctor pairs to define.
 * @param target Registry to define into. Defaults to the global `customElements`.
 */
export function defineElements(
  defs: readonly JectsElementDefinition[],
  target: CustomElementRegistry = customElements,
): void {
  for (const { tag, ctor } of defs) {
    if (!target.get(tag)) {
      target.define(tag, ctor as unknown as CustomElementConstructor);
    }
  }
}
