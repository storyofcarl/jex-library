/**
 * Dependency adapter — maps the scheduler's `DependencyModel` (typed FS/SS/FF/SF)
 * onto timeline-core's terminal-based `DependencyLink`, so the shared
 * `OrthogonalDependencyRouter` can route the four precedence shapes without
 * knowing scheduler semantics.
 *
 *   FS (finish→start)  from 'end'   → to 'start'   (default)
 *   SS (start→start)   from 'start' → to 'start'
 *   FF (finish→finish) from 'end'   → to 'end'
 *   SF (start→finish)  from 'start' → to 'end'
 */

import type { DependencyLink, DependencyTerminal } from '@jects/timeline-core';
import type { DependencyModel, DependencyType } from '../contract.js';

/** Terminal pair for each precedence type. */
const TERMINALS: Record<DependencyType, { from: DependencyTerminal; to: DependencyTerminal }> = {
  FS: { from: 'end', to: 'start' },
  SS: { from: 'start', to: 'start' },
  FF: { from: 'end', to: 'end' },
  SF: { from: 'start', to: 'end' },
};

/** Resolve a dependency's terminals, defaulting to FS. */
export function terminalsFor(type: DependencyType | undefined): {
  from: DependencyTerminal;
  to: DependencyTerminal;
} {
  return TERMINALS[type ?? 'FS'];
}

/** Map a scheduler `DependencyModel` to a timeline-core `DependencyLink`. */
export function toLink(dep: DependencyModel): DependencyLink {
  const t = terminalsFor(dep.type);
  return {
    id: dep.id,
    fromId: dep.fromId,
    toId: dep.toId,
    fromSide: t.from,
    toSide: t.to,
    ...(dep.styleKey !== undefined ? { styleKey: dep.styleKey } : {}),
  };
}

/** Map a whole set of dependencies to links. */
export function toLinks(deps: ReadonlyArray<DependencyModel>): DependencyLink[] {
  return deps.map(toLink);
}
