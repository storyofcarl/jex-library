/**
 * @jects/widgets/layout — structural containers: layout/splitter/panel/container.
 *
 * Additive subpath barrel. Importing this entry pulls in ONLY the `layout`
 * family code, never the whole widget kit. Side-effect CSS still lives in
 * `@jects/widgets/style.css`.
 */

export {
  Layout,
  type LayoutConfig,
  type LayoutEvents,
  type RegionName,
  type RegionConfig,
  type CellContent,
} from './layout/layout.js';

export {
  Splitter,
  type SplitterConfig,
  type SplitterEvents,
  type SplitterOrientation,
  type SplitterPane,
} from './layout/splitter.js';

export {
  Panel,
  type PanelConfig,
  type PanelEvents,
  type PanelBody,
} from './layout/panel.js';

export {
  Container,
  type ContainerConfig,
  type ContainerEvents,
  type ContainerLayout,
  type FlexDirection,
  type AlignValue,
  type JustifyValue,
  type ContainerItem,
} from './layout/container.js';
