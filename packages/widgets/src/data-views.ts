/**
 * @jects/widgets/data-views — collection renderers: tree/list/data-view.
 *
 * Additive subpath barrel. Importing this entry pulls in ONLY the `data-views`
 * family code, never the whole widget kit. Side-effect CSS still lives in
 * `@jects/widgets/style.css`.
 */

export {
  Tree,
  type TreeConfig,
  type TreeEvents,
  type TreeSelectionMode,
} from './data-views/tree.js';

export {
  List,
  type ListConfig,
  type ListEvents,
  type ListSelectionMode,
} from './data-views/list.js';

export {
  DataView,
  type DataViewConfig,
  type DataViewEvents,
  type DataViewSelectionMode,
} from './data-views/data-view.js';
