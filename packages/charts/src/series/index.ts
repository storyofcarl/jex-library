/**
 * `@jects/charts/series` — series resolution / stacking / value-domain math.
 *
 * A standalone re-export barrel for the pure (no-DOM) series math that the Chart
 * widget builds on. Consumers that only need to resolve config series, apply
 * stacking, or compute value domains can `import { … } from '@jects/charts/series'`
 * and pull ONLY this area — `series-math.ts` depends only on the type-only
 * `chart/types.ts` (erased at runtime), so the emitted chunk does not bundle the
 * Chart widget or the rest of the package.
 */
export {
  resolveSeries,
  applyStacking,
  valueDomain,
  axisInUse,
  isCartesian,
  isStackable,
  type ResolvedSeries,
  type Domain,
} from '../chart/series-math.js';
