/**
 * @jects/widgets/nav — navigation chrome: toolbar/menu/context-menu/sidebar/ribbon.
 *
 * Additive subpath barrel. Importing this entry pulls in ONLY the `nav` family
 * code (plus the shared Button leaf the toolbar/ribbon reference), never the
 * whole widget kit. Side-effect CSS still lives in `@jects/widgets/style.css`.
 */

export {
  Toolbar,
  type ToolbarConfig,
  type ToolbarEvents,
  type ToolbarItem,
} from './nav/toolbar.js';

export {
  Menu,
  type MenuConfig,
  type MenuEvents,
  type MenuItem,
} from './nav/menu.js';

export {
  ContextMenu,
  type ContextMenuConfig,
  type ContextMenuEvents,
  type ContextMenuCloseReason,
} from './nav/context-menu.js';

export {
  Sidebar,
  type SidebarConfig,
  type SidebarEvents,
  type SidebarItem,
} from './nav/sidebar.js';

export {
  Ribbon,
  type RibbonConfig,
  type RibbonEvents,
  type RibbonCommand,
  type RibbonGroup,
  type RibbonTab,
} from './nav/ribbon.js';
