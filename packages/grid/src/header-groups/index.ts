/**
 * @jects/grid — grouped / multi-level (stacked) column headers (area
 * "grid-header-groups").
 *
 * A self-contained, additive feature that brings the grid to Bryntum/DHTMLX
 * parity for grouped/multi-level headers without touching the engine, the
 * frozen contract, or the package barrel. Install it as a `GridFeature`:
 *
 *   import { headerGroupsFeature } from '@jects/grid';   // (after barrel wiring)
 *   grid.use(headerGroupsFeature({ headerGroups }));
 *
 * The CSS is imported here so it lands in `dist/style.css` for any consumer that
 * imports this module. Token-pure (only `--jects-*`).
 */

import './header-groups.css';

export {
  resolveHeaderTree,
  pathsFromGroups,
  hasHeaderGroups,
  type HeaderGroup,
  type GroupedColumnExtras,
  type GroupedColumnDef,
  type LeafColumnInput,
  type HeaderCell,
  type HeaderBand,
  type HeaderTree,
} from './header-tree.js';

export {
  HeaderGroupsFeature,
  headerGroupsFeature,
  type HeaderGroupsFeatureOptions,
} from './header-groups-feature.js';
